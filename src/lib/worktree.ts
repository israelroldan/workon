import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { existsSync, chmodSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { simpleGit, SimpleGit } from 'simple-git';

const exec = promisify(execCallback);

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

const WORKON_DIR = '.workon';
const WORKTREES_SUBDIR = 'worktrees';
const HOOK_DIR = '.workon';
const SETUP_HOOK = 'worktree-setup.sh';

/**
 * Generate a short hash from a path for disambiguation
 */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 8);
}

/**
 * Derive a unique project identifier from the project path
 * Uses basename + short hash of full path for uniqueness
 */
export function deriveProjectIdentifier(projectPath: string): string {
  const name = basename(projectPath);
  const hash = shortHash(projectPath);
  return `${name}-${hash}`;
}

/**
 * Get the worktrees directory for a project
 */
export function getWorktreesDirForProject(projectIdentifier: string): string {
  return join(homedir(), WORKON_DIR, WORKTREES_SUBDIR, projectIdentifier);
}

export class WorktreeManager {
  private projectPath: string;
  private projectIdentifier: string;
  private git: SimpleGit;

  constructor(projectPath: string, _projectName?: string) {
    this.projectPath = projectPath;
    // Always use derived identifier for consistency between creation and detection
    // The project name parameter is kept for potential future use (e.g., display)
    this.projectIdentifier = deriveProjectIdentifier(projectPath);
    this.git = simpleGit(projectPath);
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
    return join(homedir(), WORKON_DIR, WORKTREES_SUBDIR, this.projectIdentifier);
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
    return all.filter((wt) => wt.path.startsWith(worktreesDir));
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
    const existing = await this.get(dirName);
    if (existing) {
      if (!force) {
        throw new Error(`Worktree '${dirName}' already exists at ${existing.path}`);
      }
      // Force specified: remove existing worktree first
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
   * Merge a worktree's branch into a target branch
   */
  async merge(name: string, options: MergeOptions): Promise<void> {
    const worktree = await this.get(name);
    if (!worktree) {
      throw new Error(`Worktree '${name}' not found`);
    }

    const { targetBranch, squash } = options;

    // Ensure target branch exists
    if (!(await this.branchExists(targetBranch))) {
      throw new Error(`Target branch '${targetBranch}' does not exist`);
    }

    // Checkout target branch in main worktree
    await this.git.checkout(targetBranch);

    // Merge the worktree's branch
    const mergeArgs = ['merge'];
    if (squash) {
      mergeArgs.push('--squash');
    }
    mergeArgs.push(worktree.branch);

    await this.git.raw(mergeArgs);

    // If squash merge, we need to commit
    if (squash) {
      await this.git.commit(`Merge ${worktree.branch} into ${targetBranch} (squashed)`);
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
  async runPostSetupHook(worktreePath: string): Promise<{ stdout: string; stderr: string }> {
    const hookPath = this.getSetupHookPath();

    if (!existsSync(hookPath)) {
      throw new Error('Setup hook not found');
    }

    // Ensure hook is executable
    try {
      chmodSync(hookPath, '755');
    } catch {
      // Ignore chmod errors on systems that don't support it
    }

    const env = {
      ...process.env,
      WORKTREE_PATH: worktreePath,
      PROJECT_PATH: this.projectPath,
    };

    const { stdout, stderr } = await exec(hookPath, {
      cwd: worktreePath,
      env,
    });

    return { stdout, stderr };
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
        if (path.startsWith(worktreesDir)) {
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
