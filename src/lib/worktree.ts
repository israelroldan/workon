import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { existsSync, chmodSync, realpathSync } from 'fs';
import { join, basename, relative, isAbsolute } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { simpleGit, SimpleGit, type StatusResult } from 'simple-git';

const execFile = promisify(execFileCallback);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  name: string;
}

export interface AddWorktreeOptions {
  branch: string;
  baseBranch?: string;
  force?: boolean;
}

export interface MergeOptions {
  targetBranch: string;
  squash?: boolean;
}

export interface MergeResult {
  /** Branch the main worktree was on before the merge, if we moved off it */
  previousBranch: string | null;
  /** True when the main worktree was put back on `previousBranch` afterwards */
  restored: boolean;
}

export interface WorktreeBranchInfo {
  /** The branch this worktree was created for */
  branch: string;
  /** False when that branch no longer exists locally and would have to be recreated */
  exists: boolean;
}

export interface HookResult {
  stdout: string;
  stderr: string;
}

const WORKON_DIR = '.workon';
const WORKTREES_SUBDIR = 'worktrees';
const HOOK_DIR = '.workon';
const SETUP_HOOK = 'worktree-setup.sh';
const TEARDOWN_HOOK = 'worktree-teardown.sh';

/** Hooks routinely run installers; give them room and a ceiling instead of hanging forever. */
const HOOK_TIMEOUT_MS = resolveHookTimeout();
const HOOK_MAX_BUFFER = 32 * 1024 * 1024;

function resolveHookTimeout(): number {
  // 0 is Node's "no timeout", which is exactly what someone with a very long
  // hook would set - so accept it instead of falling through to the default.
  const configured = Number(process.env.WORKON_HOOK_TIMEOUT);
  return Number.isFinite(configured) && configured >= 0 ? configured : 15 * 60 * 1000;
}

/**
 * Run a git command whose failure is expected, and report "no result" as null.
 *
 * simple-git only treats a command as failed when it writes to stderr, and
 * `--quiet` git commands exit non-zero while staying silent - so probing for a
 * missing ref comes back as a *successful* empty string. Never infer failure
 * from the absence of a throw here; go by the output.
 */
export async function gitProbe(git: SimpleGit, args: string[]): Promise<string | null> {
  try {
    const output = (await git.raw(args)).trim();
    return output === '' ? null : output;
  } catch {
    return null;
  }
}

/**
 * True when `child` lives strictly inside `parent`.
 *
 * A plain `startsWith()` would treat `~/.workon/worktrees/app-1234abcd-old` as
 * being inside `~/.workon/worktrees/app-1234abcd`, which misclassifies another
 * project's worktrees as managed by this one.
 */
export function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Generate a short hash from a path for disambiguation
 */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 8);
}

/**
 * True when tracked files have been modified, staged, deleted or conflicted.
 *
 * Untracked files are deliberately ignored: they survive a branch switch
 * untouched, and git refuses the checkout itself if one would be overwritten.
 * Counting them would block merges on things like an uncommitted local script
 * or a stray build artifact.
 */
function hasTrackedChanges(status: StatusResult): boolean {
  return status.files.some((file) => !(file.index === '?' && file.working_dir === '?'));
}

/**
 * Resolve symlinks in a path, leaving it untouched if it can't be resolved.
 *
 * The same project reaches us by two routes: git reports realpaths
 * (`--show-toplevel`) while configured project paths may run through a symlink
 * (e.g. a `~/code` link to another volume). Without normalizing, the two hash
 * differently and the project ends up with two separate worktree directories.
 */
export function normalizePath(inputPath: string): string {
  try {
    return realpathSync(inputPath);
  } catch {
    // Path may not exist yet - fall back to what we were given.
    return inputPath;
  }
}

/**
 * Derive a unique project identifier from the project path
 * Uses basename + short hash of full path for uniqueness
 */
export function deriveProjectIdentifier(projectPath: string): string {
  const resolved = normalizePath(projectPath);
  const name = basename(resolved);
  const hash = shortHash(resolved);
  return `${name}-${hash}`;
}

/**
 * Get the worktrees directory for a project
 */
export function getWorktreesDirForProject(projectIdentifier: string): string {
  // homedir() is normalized because every path it gets compared against comes
  // back from git as a realpath.
  return join(normalizePath(homedir()), WORKON_DIR, WORKTREES_SUBDIR, projectIdentifier);
}

/**
 * Identifier as it was derived before paths were realpath-normalized.
 * Only used to keep already-created worktrees reachable after an upgrade.
 */
function legacyProjectIdentifier(projectPath: string): string {
  return `${basename(projectPath)}-${shortHash(projectPath)}`;
}

/**
 * Resolve which identifier a project's worktrees actually live under.
 *
 * Normalizing paths changed the hash for anyone whose project path runs through
 * a symlink. Their existing `~/.workon/worktrees/{old-id}/` would otherwise stop
 * being recognised as managed, so keep using it when it is there.
 */
export function resolveProjectIdentifier(projectPath: string): string {
  const current = deriveProjectIdentifier(projectPath);
  if (existsSync(getWorktreesDirForProject(current))) {
    return current;
  }

  const legacy = legacyProjectIdentifier(projectPath);
  if (legacy !== current && existsSync(getWorktreesDirForProject(legacy))) {
    return legacy;
  }

  return current;
}

export class WorktreeManager {
  private projectPath: string;
  private projectIdentifier: string;
  private git: SimpleGit;

  constructor(projectPath: string, _projectName?: string) {
    // Store the resolved path: `git worktree list` reports realpaths, and
    // parseWorktreeList compares against this to find the main worktree.
    this.projectPath = normalizePath(projectPath);
    // Always use derived identifier for consistency between creation and detection
    // The project name parameter is kept for potential future use (e.g., display)
    // Derived from the path as given, so a pre-normalization directory still resolves.
    this.projectIdentifier = resolveProjectIdentifier(projectPath);
    this.git = simpleGit(this.projectPath);
  }

  /**
   * Check if the project is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the worktrees directory path
   * Stored at ~/.workon/worktrees/{project-identifier}/
   */
  getWorktreesDir(): string {
    return getWorktreesDirForProject(this.projectIdentifier);
  }

  /**
   * Convert branch name to directory name (replace slashes with dashes)
   */
  branchToDir(branch: string): string {
    return branch.replace(/\//g, '-');
  }

  /**
   * List all worktrees for this repository
   */
  async list(): Promise<WorktreeInfo[]> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain']);
    return this.parseWorktreeList(result);
  }

  /**
   * List only worktrees managed by workon (under .worktrees/)
   */
  async listManagedWorktrees(): Promise<WorktreeInfo[]> {
    const all = await this.list();
    const worktreesDir = this.getWorktreesDir();
    return all.filter((wt) => isPathInside(wt.path, worktreesDir));
  }

  /**
   * Get a specific worktree by name (searches all worktrees, not just managed ones)
   */
  async get(name: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.list();
    // Search by name or branch name
    return (
      worktrees.find(
        (wt) => wt.name === name || wt.branch === name || this.branchToDir(wt.branch) === name
      ) || null
    );
  }

  /**
   * Create a new worktree
   */
  async add(options: AddWorktreeOptions): Promise<WorktreeInfo> {
    const { branch, baseBranch, force } = options;
    const dirName = this.branchToDir(branch);
    const worktreePath = join(this.getWorktreesDir(), dirName);

    // Check if worktree already exists
    let existing = await this.get(dirName);

    if (existing && !existsSync(existing.path)) {
      // The directory was deleted outside of workon (rm -rf, disk cleanup...).
      // Prune the stale registration so this add can proceed instead of failing
      // on a worktree that no longer exists.
      await this.git.raw(['worktree', 'prune']);
      existing = await this.get(dirName);
      if (existing) {
        await this.git.raw(['worktree', 'remove', '--force', existing.path]);
        existing = null;
      }
    }

    if (existing) {
      if (!force) {
        throw new Error(`Worktree '${dirName}' already exists at ${existing.path}`);
      }
      // Force specified: replace it, but never silently discard work in progress.
      if (await this.hasUncommittedChanges(existing.path)) {
        throw new Error(
          `Worktree '${dirName}' has uncommitted changes at ${existing.path}. ` +
            `Commit or stash them, or remove it explicitly with ` +
            `'workon worktrees remove ${dirName} --force'.`
        );
      }
      await this.git.raw(['worktree', 'remove', '--force', existing.path]);
    }

    // Check if branch exists
    const branchExists = await this.branchExists(branch);

    const args = ['worktree', 'add'];

    if (branchExists) {
      // Checkout existing branch - use --force in case branch is checked out elsewhere
      if (force) {
        args.push('--force');
      }
      args.push(worktreePath, branch);
    } else {
      // Create new branch from baseBranch or current HEAD
      args.push('-b', branch, worktreePath);
      if (baseBranch) {
        args.push(baseBranch);
      }
    }

    await this.git.raw(args);

    // Return the created worktree info
    const worktree = await this.get(dirName);
    if (!worktree) {
      throw new Error('Failed to create worktree');
    }
    return worktree;
  }

  /**
   * Remove a worktree
   */
  async remove(name: string, force = false): Promise<void> {
    const worktree = await this.get(name);
    if (!worktree) {
      throw new Error(`Worktree '${name}' not found`);
    }

    if (worktree.isMain) {
      throw new Error('Cannot remove the main worktree');
    }

    // If the directory is missing, force is required for git worktree remove
    const pathMissing = !existsSync(worktree.path);

    // Check for uncommitted changes (skipped if directory is missing)
    if (!pathMissing && !force && (await this.hasUncommittedChanges(name))) {
      throw new Error(`Worktree '${name}' has uncommitted changes. Use --force to remove anyway.`);
    }

    const args = ['worktree', 'remove'];
    if (force || pathMissing) {
      args.push('--force');
    }
    args.push(worktree.path);

    await this.git.raw(args);
  }

  /**
   * Check if a worktree has uncommitted changes
   * Accepts worktree name, branch name, or path
   */
  async hasUncommittedChanges(nameOrPath: string): Promise<boolean> {
    // Try to find by name first
    let worktree = await this.get(nameOrPath);

    // If not found and looks like a path, try direct access
    if (!worktree && nameOrPath.startsWith('/')) {
      const all = await this.list();
      worktree = all.find((wt) => wt.path === nameOrPath) || null;
    }

    if (!worktree) {
      throw new Error(`Worktree '${nameOrPath}' not found`);
    }

    // If the directory doesn't exist on disk, there are no changes to lose
    if (!existsSync(worktree.path)) {
      return false;
    }

    const worktreeGit = simpleGit(worktree.path);
    const status = await worktreeGit.status();
    return !status.isClean();
  }

  /**
   * Get the current branch of the main worktree
   */
  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  }

  /**
   * Get all local branches
   */
  async getBranches(): Promise<string[]> {
    const result = await this.git.branchLocal();
    return result.all;
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branch: string): Promise<boolean> {
    try {
      await this.git.revparse(['--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * True when this worktree lives in the directory workon manages for the project.
   * Anything else was created by hand with `git worktree add` and is not ours.
   */
  isManaged(worktree: WorktreeInfo): boolean {
    return isPathInside(worktree.path, this.getWorktreesDir());
  }

  /**
   * Find the worktree (if any) that currently has `branch` checked out.
   * git refuses to check a branch out in two places at once, so callers use
   * this to fail with a useful message instead of a raw git fatal.
   */
  async getWorktreeForBranch(branch: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.list();
    return worktrees.find((wt) => wt.branch === branch) || null;
  }

  /**
   * Resolve the branch a worktree was *created for*.
   *
   * `git worktree list` reports the branch that is checked out right now, which
   * may have moved on (e.g. after `workon worktrees branch <wt> pr-branch`).
   * Managed worktree directories are named after their original branch via
   * `branchToDir()`, so for those we map the directory name back to a local
   * branch.
   *
   * The branch may have been deleted since - typically cleaned up after it was
   * merged - which is why the result reports whether it still exists rather
   * than quietly falling back to whatever happens to be checked out.
   */
  async getOriginalBranch(name: string): Promise<WorktreeBranchInfo | null> {
    const worktree = await this.get(name);
    if (!worktree) {
      return null;
    }

    const currentBranch =
      worktree.branch && worktree.branch !== '(detached)' ? worktree.branch : null;

    if (!this.isManaged(worktree)) {
      // External worktrees have no naming convention to reason from.
      return currentBranch ? { branch: currentBranch, exists: true } : null;
    }

    const dirName = basename(worktree.path);
    const branches = await this.getBranches();

    // Exact match wins: 'feat-x' the branch beats 'feat/x' mapping to 'feat-x'.
    if (branches.includes(dirName)) {
      return { branch: dirName, exists: true };
    }
    const mapped = branches.find((b) => this.branchToDir(b) === dirName);
    if (mapped) {
      return { branch: mapped, exists: true };
    }

    // The worktree's own branch is gone (usually cleaned up after merging).
    // The directory name is a flattened form of it, so check the remote for the
    // real name before falling back - that's the only way to recover the
    // slashes in something like 'feature/login'.
    const remoteMatch = (await this.getRemoteBranchNames()).find(
      (b) => this.branchToDir(b) === dirName
    );

    return { branch: remoteMatch || dirName, exists: false };
  }

  /**
   * Local names of remote-tracking branches ('origin/feature/x' -> 'feature/x').
   */
  private async getRemoteBranchNames(): Promise<string[]> {
    // Read the raw output: simple-git's branch() parser returns nothing at all
    // when given a custom --format.
    const output = await gitProbe(this.git, ['branch', '-r', '--format=%(refname:short)']);
    if (!output) {
      return [];
    }

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((ref) => ref && !ref.endsWith('/HEAD')) // skip the origin/HEAD alias
      .map((ref) => ref.split('/').slice(1).join('/'))
      .filter(Boolean);
  }

  /**
   * Merge a worktree's branch into a target branch.
   *
   * The merge happens in the main worktree, so this both requires it to be clean
   * and puts it back on the branch it started on - leaving someone's main
   * checkout silently parked on `targetBranch` is a nasty surprise.
   */
  async merge(name: string, options: MergeOptions): Promise<MergeResult> {
    const worktree = await this.get(name);
    if (!worktree) {
      throw new Error(`Worktree '${name}' not found`);
    }

    if (!worktree.branch || worktree.branch === '(detached)') {
      throw new Error(`Worktree '${name}' is in detached HEAD state and has no branch to merge`);
    }

    const { targetBranch, squash } = options;

    // Ensure target branch exists
    if (!(await this.branchExists(targetBranch))) {
      throw new Error(`Target branch '${targetBranch}' does not exist`);
    }

    if (targetBranch === worktree.branch) {
      throw new Error(`Cannot merge '${worktree.branch}' into itself`);
    }

    // A dirty main worktree would either block the checkout or drag local
    // changes onto the target branch mid-merge.
    const mainStatus = await this.git.status();
    if (hasTrackedChanges(mainStatus)) {
      throw new Error(
        'The main worktree has uncommitted changes. Commit or stash them before merging.'
      );
    }

    // git only allows one checkout of a branch across all worktrees.
    const holder = await this.getWorktreeForBranch(targetBranch);
    if (holder && !holder.isMain) {
      throw new Error(
        `Branch '${targetBranch}' is checked out in worktree '${holder.name}' (${holder.path}). ` +
          `Switch that worktree to another branch first.`
      );
    }

    const previousBranch = await this.getCurrentBranch();
    const shouldRestore = previousBranch !== targetBranch && previousBranch !== 'HEAD';

    await this.git.checkout(targetBranch);

    try {
      // --no-edit keeps git from trying to open an editor for the merge message.
      const mergeArgs = ['merge', '--no-edit'];
      if (squash) {
        mergeArgs.push('--squash');
      }
      mergeArgs.push(worktree.branch);

      await this.git.raw(mergeArgs);

      // simple-git only reports a command as failed when it writes to stderr,
      // and git announces merge conflicts on stdout - so a conflicted merge
      // comes back looking like a success. Inspect the result instead of
      // trusting that: reporting a conflicted merge as done is how a caller
      // ends up deleting the worktree and branch whose work never landed.
      const postStatus = await this.git.status();
      if (postStatus.conflicted.length > 0) {
        throw new Error(
          `Merge conflict in ${postStatus.conflicted.length} file(s): ` +
            `${postStatus.conflicted.join(', ')}`
        );
      }

      // A squash merge only stages the result; it still needs a commit.
      if (squash) {
        if (postStatus.isClean()) {
          throw new Error(
            `Nothing to merge: '${worktree.branch}' is already contained in '${targetBranch}'`
          );
        }
        await this.git.commit(`Merge ${worktree.branch} into ${targetBranch} (squashed)`);
      }
    } catch (error) {
      // Don't strand the main worktree mid-merge. We verified it was clean
      // above, so discarding the failed merge state loses nothing.
      await this.abortMerge();
      if (shouldRestore) {
        await this.git.checkout(previousBranch).catch(() => {});
      }
      throw error;
    }

    if (shouldRestore) {
      await this.git.checkout(previousBranch);
    }

    return { previousBranch, restored: shouldRestore };
  }

  /**
   * Roll back an in-progress merge in the main worktree.
   * `merge --abort` handles a normal merge; a conflicted `--squash` merge has no
   * MERGE_HEAD to abort, so it needs a hard reset instead.
   */
  private async abortMerge(): Promise<void> {
    try {
      await this.git.raw(['merge', '--abort']);
      return;
    } catch {
      // Not a normal merge in progress - fall through.
    }
    try {
      await this.git.raw(['reset', '--hard', 'HEAD']);
    } catch {
      // Nothing else we can safely do; the original error is what matters.
    }
  }

  /**
   * Check if a post-setup hook exists
   */
  hasSetupHook(): boolean {
    const hookPath = this.getSetupHookPath();
    return existsSync(hookPath);
  }

  /**
   * Get the path to the setup hook
   */
  getSetupHookPath(): string {
    return join(this.projectPath, HOOK_DIR, SETUP_HOOK);
  }

  /**
   * Run the post-setup hook for a worktree
   */
  async runPostSetupHook(worktreePath: string): Promise<HookResult> {
    return this.runHook(this.getSetupHookPath(), 'Setup', worktreePath);
  }

  /**
   * Check if a pre-teardown hook exists
   */
  hasTeardownHook(): boolean {
    const hookPath = this.getTeardownHookPath();
    return existsSync(hookPath);
  }

  /**
   * Get the path to the teardown hook
   */
  getTeardownHookPath(): string {
    return join(this.projectPath, HOOK_DIR, TEARDOWN_HOOK);
  }

  /**
   * Run the pre-teardown hook for a worktree
   */
  async runPreTeardownHook(worktreePath: string): Promise<HookResult> {
    return this.runHook(this.getTeardownHookPath(), 'Teardown', worktreePath);
  }

  /**
   * Execute a worktree hook script.
   *
   * Uses execFile rather than exec so the hook path is passed as an argv entry:
   * a project living in a directory with a space (or any shell metacharacter)
   * would otherwise be word-split by /bin/sh and fail - or worse, run something
   * unintended. Hooks commonly run installers, so they also get a generous
   * output buffer and a timeout instead of an unbounded wait.
   */
  private async runHook(hookPath: string, kind: string, worktreePath: string): Promise<HookResult> {
    if (!existsSync(hookPath)) {
      throw new Error(`${kind} hook not found at ${hookPath}`);
    }

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree directory no longer exists: ${worktreePath}`);
    }

    // Ensure hook is executable
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      // Ignore chmod errors on systems that don't support it
    }

    const env = {
      ...process.env,
      WORKTREE_PATH: worktreePath,
      PROJECT_PATH: this.projectPath,
      WORKTREE_NAME: basename(worktreePath),
    };

    try {
      const { stdout, stderr } = await execFile(hookPath, [], {
        cwd: worktreePath,
        env,
        timeout: HOOK_TIMEOUT_MS,
        maxBuffer: HOOK_MAX_BUFFER,
        encoding: 'utf8',
      });
      return { stdout, stderr };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        killed?: boolean;
        stderr?: string;
        stdout?: string;
      };

      if (err.killed) {
        throw new Error(
          `${kind} hook timed out after ${Math.round(HOOK_TIMEOUT_MS / 1000)}s ` +
            `(override with WORKON_HOOK_TIMEOUT, in milliseconds)`
        );
      }
      if (err.code === 'ENOENT') {
        throw new Error(`${kind} hook could not be executed: ${hookPath}`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`${kind} hook is not executable: chmod +x ${hookPath}`);
      }
      if (err.code === 'ENOEXEC') {
        // `exec()` used to hand the file to /bin/sh, which happily interprets a
        // shebang-less script. execFile can't, so run it under sh explicitly
        // rather than breaking hooks that have always worked.
        return this.runHookUnderShell(hookPath, kind, worktreePath, env);
      }

      throw this.hookFailure(kind, err);
    }
  }

  /**
   * Fallback for hooks with no `#!` line, which only run because a shell is
   * willing to interpret them.
   */
  private async runHookUnderShell(
    hookPath: string,
    kind: string,
    worktreePath: string,
    env: NodeJS.ProcessEnv
  ): Promise<HookResult> {
    try {
      const { stdout, stderr } = await execFile('/bin/sh', [hookPath], {
        cwd: worktreePath,
        env,
        timeout: HOOK_TIMEOUT_MS,
        maxBuffer: HOOK_MAX_BUFFER,
        encoding: 'utf8',
      });
      return { stdout, stderr };
    } catch (error) {
      throw this.hookFailure(kind, error as NodeJS.ErrnoException);
    }
  }

  /** Surface the hook's own diagnostics; the raw error is just an exit code. */
  private hookFailure(
    kind: string,
    err: NodeJS.ErrnoException & { killed?: boolean; stderr?: string; stdout?: string }
  ): Error {
    if (err.killed) {
      return new Error(
        `${kind} hook timed out after ${Math.round(HOOK_TIMEOUT_MS / 1000)}s ` +
          `(override with WORKON_HOOK_TIMEOUT, in milliseconds)`
      );
    }
    const detail = (err.stderr || err.stdout || '').trim();
    return new Error(detail ? `${kind} hook failed:\n${detail}` : `${kind} hook failed`);
  }

  /**
   * Parse the porcelain output of git worktree list
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.split('\n');
      let path = '';
      let head = '';
      let branch = '';
      let isMain = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.substring('worktree '.length);
          // First worktree is the main one
          isMain = worktrees.length === 0;
        } else if (line.startsWith('HEAD ')) {
          head = line.substring('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          // Format: branch refs/heads/branch-name
          branch = line.substring('branch refs/heads/'.length);
        } else if (line === 'detached') {
          branch = '(detached)';
        }
      }

      if (path) {
        // Calculate name from path
        const worktreesDir = this.getWorktreesDir();
        let name: string;
        if (isPathInside(path, worktreesDir)) {
          // Managed worktree under ~/.workon/worktrees/{project}/
          name = basename(path);
        } else if (path === this.projectPath) {
          // Main worktree
          name = '(main)';
        } else {
          // External worktree - use branch name converted to dir format, or basename
          name = branch && branch !== '(detached)' ? this.branchToDir(branch) : basename(path);
        }

        worktrees.push({
          path,
          branch,
          head,
          isMain,
          name,
        });
      }
    }

    return worktrees;
  }
}
