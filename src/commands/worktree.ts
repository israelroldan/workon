import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { existsSync } from 'fs';
import { select, confirm } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';
import type { Config } from '../lib/config.js';
import type { Logger } from '../types/index.js';
import { WorktreeManager, gitProbe, type WorktreeBranchInfo } from '../lib/worktree.js';
import { TmuxManager } from '../lib/tmux.js';
import { resolveProjectFromCwd, type WorktreeInfo } from './worktrees/utils.js';

interface WorktreeContext {
  config: Config;
  log: Logger;
}

interface ResolvedWorktree {
  info: WorktreeInfo & { worktreePath: string; worktreeName: string };
  /** Name used to build the tmux session; must match `workon worktrees open` */
  displayName: string;
}

/**
 * Resolve the worktree we're standing in, or exit with a useful message.
 *
 * Goes through resolveProjectFromCwd rather than detectWorktreeContext so we
 * pick up the *registered* project name: `workon worktrees open` derives tmux
 * session names from it, and deriving them from the directory basename here
 * meant we killed a session that didn't exist while the real one lived on.
 */
async function requireWorktree(ctx: WorktreeContext, hint?: string): Promise<ResolvedWorktree> {
  const { config, log } = ctx;
  const projectCtx = await resolveProjectFromCwd(config, log);

  if (!projectCtx) {
    log.error('Not in a git repository.');
    process.exit(1);
  }

  const info = projectCtx.worktreeInfo;

  if (!info.isWorktree) {
    log.error("You're in the main repository, not a worktree.");
    if (hint) {
      log.info(hint);
    }
    process.exit(1);
  }

  if (!info.worktreePath || !info.worktreeName) {
    log.error('Unable to determine worktree info.');
    process.exit(1);
  }

  if (!existsSync(info.worktreePath)) {
    log.error(`Worktree directory is missing from disk: ${info.worktreePath}`);
    process.exit(1);
  }

  return {
    info: info as ResolvedWorktree['info'],
    displayName: projectCtx.projectName || path.basename(info.mainRepoPath),
  };
}

/**
 * Uncommitted-changes check that talks to the worktree directly.
 * WorktreeManager.hasUncommittedChanges throws when the name can't be resolved,
 * which surfaced as an unhandled rejection from inside a worktree.
 */
async function worktreeHasChanges(worktreePath: string): Promise<boolean> {
  const status = await simpleGit(worktreePath).status();
  return !status.isClean();
}

/**
 * Create the singular 'worktree' command for operating on the current worktree
 */
export function createWorktreeCommand(ctx: WorktreeContext): Command {
  const { log } = ctx;

  const command = new Command('worktree').description(
    'Operate on the current worktree (run from within a worktree)'
  );

  // Default action: show worktree status
  command.action(async () => {
    const { info } = await requireWorktree(
      ctx,
      `Use 'workon worktrees' to manage worktrees for this project.`
    );
    await showWorktreeStatus(info, log);
  });

  // Subcommand: status
  command
    .command('status')
    .description('Show status of the current worktree')
    .action(async () => {
      const { info } = await requireWorktree(ctx);
      await showWorktreeStatus(info, log);
    });

  // Subcommand: merge
  command
    .command('merge')
    .description('Merge this worktree branch into a target branch')
    .option('-i, --into <branch>', 'Target branch to merge into')
    .option('-s, --squash', 'Use squash merge')
    .option('-k, --keep', 'Keep the worktree after merging')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--delete-branch', 'Delete the merged branch after merge')
    .action(
      async (options: {
        into?: string;
        squash?: boolean;
        keep?: boolean;
        yes?: boolean;
        deleteBranch?: boolean;
      }) => {
        const resolved = await requireWorktree(
          ctx,
          `Use 'workon worktrees merge <name>' from the main repository.`
        );
        await mergeCurrentWorktree(resolved, options, ctx);
      }
    );

  // Subcommand: remove
  command
    .command('remove')
    .description('Remove the current worktree')
    .option('-f, --force', 'Force removal even with uncommitted changes')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options: { force?: boolean; yes?: boolean }) => {
      const resolved = await requireWorktree(
        ctx,
        `Use 'workon worktrees remove <name>' from the main repository.`
      );
      await removeCurrentWorktree(resolved, options, ctx);
    });

  // Subcommand: recycle
  command
    .command('recycle')
    .description(
      'Recycle this worktree for the next task: switch to its original branch and fast-forward to a remote branch'
    )
    .argument('[branch]', 'Remote branch to fast-forward to (auto-detects default)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (branch: string | undefined, options: { yes?: boolean }) => {
      const resolved = await requireWorktree(ctx);
      await recycleCurrentWorktree(resolved, branch, options, ctx);
    });

  return command;
}

async function showWorktreeStatus(worktreeInfo: WorktreeInfo, log: Logger): Promise<void> {
  if (!worktreeInfo.worktreePath) {
    log.error('Unable to determine worktree path.');
    return;
  }

  const git = simpleGit(worktreeInfo.worktreePath);

  // Get git status. isClean() also covers conflicted and renamed entries, which
  // an explicit list of buckets kept missing.
  const status = await git.status();
  const hasChanges = !status.isClean();

  console.log(chalk.bold('\nCurrent Worktree:'));
  console.log('-'.repeat(50));
  console.log(`  Name:     ${chalk.cyan(worktreeInfo.worktreeName)}`);
  console.log(
    `  Branch:   ${worktreeInfo.branch === '(detached)' ? chalk.yellow(worktreeInfo.branch) : chalk.green(worktreeInfo.branch)}`
  );
  console.log(`  Path:     ${chalk.gray(worktreeInfo.worktreePath)}`);
  console.log(`  Main:     ${chalk.gray(worktreeInfo.mainRepoPath)}`);
  console.log(
    `  Status:   ${hasChanges ? chalk.yellow('uncommitted changes') : chalk.green('clean')}`
  );

  if (hasChanges) {
    console.log(`\n${chalk.bold('Changes:')}`);
    if (status.staged.length > 0) {
      console.log(`  Staged:   ${status.staged.length} file(s)`);
    }
    if (status.modified.length > 0) {
      console.log(`  Modified: ${status.modified.length} file(s)`);
    }
    if (status.not_added.length > 0) {
      console.log(`  Untracked: ${status.not_added.length} file(s)`);
    }
    if (status.deleted.length > 0) {
      console.log(`  Deleted:  ${status.deleted.length} file(s)`);
    }
    if (status.conflicted.length > 0) {
      console.log(`  Conflicted: ${status.conflicted.length} file(s)`);
    }
  }

  console.log(`\n${chalk.bold('Commands:')}`);
  console.log(`  workon worktree merge   - Merge this branch and remove worktree`);
  console.log(`  workon worktree recycle - Reset worktree for the next task`);
  console.log(`  workon worktree remove  - Remove this worktree`);
  console.log();
}

async function mergeCurrentWorktree(
  resolved: ResolvedWorktree,
  options: {
    into?: string;
    squash?: boolean;
    keep?: boolean;
    yes?: boolean;
    deleteBranch?: boolean;
  },
  ctx: WorktreeContext
): Promise<void> {
  const { log } = ctx;
  const { info: worktreeInfo, displayName } = resolved;

  if (worktreeInfo.branch === '(detached)') {
    log.error('Cannot merge a detached HEAD. Create a branch first.');
    log.info(`Use 'git checkout -b <branch-name>' to create a branch.`);
    process.exit(1);
  }

  const manager = new WorktreeManager(worktreeInfo.mainRepoPath);

  // Check for uncommitted changes
  const hasChanges = await worktreeHasChanges(worktreeInfo.worktreePath);
  if (hasChanges) {
    log.error('This worktree has uncommitted changes.');
    log.info('Please commit or stash your changes before merging.');
    process.exit(1);
  }

  // Select target branch
  let targetBranch = options.into;
  if (!targetBranch) {
    const branches = await manager.getBranches();
    const targetBranches = branches.filter((b) => b !== worktreeInfo.branch);

    if (targetBranches.length === 0) {
      log.error('No other branches available to merge into.');
      process.exit(1);
    }

    const commonTargets = ['main', 'master', 'develop', 'dev'];
    const defaultTarget =
      commonTargets.find((t) => targetBranches.includes(t)) || targetBranches[0];

    if (options.yes) {
      targetBranch = defaultTarget;
      log.info(`Auto-selected target branch: '${targetBranch}'`);
    } else {
      targetBranch = await select({
        message: `Merge '${worktreeInfo.branch}' into which branch?`,
        choices: targetBranches.map((b) => ({ name: b, value: b })),
        default: defaultTarget,
      });
    }
  }

  // Verify target branch exists
  if (!(await manager.branchExists(targetBranch))) {
    log.error(`Target branch '${targetBranch}' does not exist.`);
    process.exit(1);
  }

  // Select merge strategy
  let squash = options.squash;
  if (squash === undefined && !options.yes) {
    squash = await confirm({
      message: 'Use squash merge? (combines all commits into one)',
      default: false,
    });
  }

  // Confirm the operation
  if (!options.yes) {
    console.log(`\n${chalk.bold('Merge operation:')}`);
    console.log(`  Source:  ${chalk.green(worktreeInfo.branch)}`);
    console.log(`  Target:  ${chalk.cyan(targetBranch)}`);
    console.log(`  Method:  ${squash ? 'Squash merge' : 'Regular merge'}`);
    console.log(`  Action:  ${options.keep ? 'Keep worktree' : 'Remove worktree after merge'}`);
    console.log();

    const shouldProceed = await confirm({
      message: 'Proceed with merge?',
      default: true,
    });

    if (!shouldProceed) {
      log.info('Merge cancelled.');
      return;
    }
  }

  // Perform the merge
  const mergeSpinner = ora(`Merging '${worktreeInfo.branch}' into '${targetBranch}'...`).start();

  try {
    const result = await manager.merge(worktreeInfo.worktreeName, {
      targetBranch,
      squash: squash || false,
    });
    mergeSpinner.succeed(`Successfully merged '${worktreeInfo.branch}' into '${targetBranch}'`);
    if (result.restored && result.previousBranch) {
      log.debug(`Main worktree restored to '${result.previousBranch}'`);
    }
  } catch (error) {
    mergeSpinner.fail(`Merge failed: ${(error as Error).message}`);
    log.info('Nothing was merged or removed; the worktree and its branch are untouched.');
    process.exit(1);
  }

  // Warn about conflicting flags
  if (options.keep && options.deleteBranch) {
    log.warn('--delete-branch is ignored when --keep is set (branch is needed by the worktree).');
  }

  // Remove worktree if not keeping
  if (!options.keep) {
    let shouldContinue = true;

    if (!options.yes) {
      log.warn('You need to exit this worktree directory before it can be removed.');

      shouldContinue = await confirm({
        message: `Remove worktree '${worktreeInfo.worktreeName}'? (You'll need to cd out first)`,
        default: true,
      });
    }

    if (shouldContinue) {
      // Kill any associated tmux session
      const tmux = new TmuxManager();
      const sessionName = tmux.getWorktreeSessionName(displayName, worktreeInfo.worktreeName);
      if (await tmux.sessionExists(sessionName)) {
        log.debug(`Killing tmux session: ${sessionName}`);
        await tmux.killSession(sessionName);
      }

      log.info(`\nTo complete removal, run from the main project directory:`);
      console.log(chalk.cyan(`  cd ${worktreeInfo.mainRepoPath}`));
      console.log(chalk.cyan(`  workon worktrees remove ${worktreeInfo.worktreeName}`));
    }

    // Ask about deleting the branch
    let shouldDeleteBranch = options.deleteBranch || false;
    if (!shouldDeleteBranch && !options.yes) {
      shouldDeleteBranch = await confirm({
        message: `Delete the merged branch '${worktreeInfo.branch}'?`,
        default: false,
      });
    }

    if (shouldDeleteBranch) {
      const deleteSpinner = ora(`Deleting branch '${worktreeInfo.branch}'...`).start();
      try {
        const git = simpleGit(worktreeInfo.mainRepoPath);
        await git.deleteLocalBranch(worktreeInfo.branch!, true);
        deleteSpinner.succeed(`Branch '${worktreeInfo.branch}' deleted`);
      } catch (error) {
        deleteSpinner.warn(`Failed to delete branch: ${(error as Error).message}`);
      }
    }
  }

  console.log(chalk.green('\nMerge completed!'));
}

async function removeCurrentWorktree(
  resolved: ResolvedWorktree,
  options: { force?: boolean; yes?: boolean },
  ctx: WorktreeContext
): Promise<void> {
  const { log } = ctx;
  const { info: worktreeInfo } = resolved;

  // Check for uncommitted changes
  const hasChanges = await worktreeHasChanges(worktreeInfo.worktreePath);
  if (hasChanges && !options.force) {
    log.warn('This worktree has uncommitted changes.');

    if (!options.yes) {
      const shouldForce = await confirm({
        message: 'Do you want to force removal and lose these changes?',
        default: false,
      });

      if (!shouldForce) {
        log.info('Removal cancelled.');
        return;
      }
      options.force = true;
    } else {
      log.error('Use --force to remove worktrees with uncommitted changes.');
      process.exit(1);
    }
  }

  // Confirm removal
  if (!options.yes) {
    console.log(`\n${chalk.bold('Worktree to remove:')}`);
    console.log(`  Name:   ${chalk.cyan(worktreeInfo.worktreeName)}`);
    console.log(
      `  Branch: ${worktreeInfo.branch === '(detached)' ? chalk.yellow(worktreeInfo.branch) : chalk.green(worktreeInfo.branch)}`
    );
    console.log(`  Path:   ${chalk.gray(worktreeInfo.worktreePath)}`);
    console.log();

    const shouldRemove = await confirm({
      message: `Remove this worktree?`,
      default: true,
    });

    if (!shouldRemove) {
      log.info('Removal cancelled.');
      return;
    }
  }

  log.warn("You're currently inside this worktree. You need to exit before removal.");
  log.info(`\nTo remove this worktree:`);
  console.log(chalk.cyan(`  cd ${worktreeInfo.mainRepoPath}`));
  console.log(
    chalk.cyan(
      `  workon worktrees remove ${worktreeInfo.worktreeName}${options.force ? ' --force' : ''}`
    )
  );
}

/**
 * Resolve the original branch a worktree was created for.
 *
 * `git worktree list --porcelain` reports the *currently* checked-out branch,
 * which may have moved on (e.g. after `worktrees branch feat-x pr-branch`), so
 * the manager maps the worktree's directory name back to a local branch.
 */
async function getWorktreeOriginalBranch(
  mainRepoPath: string,
  worktreeName: string
): Promise<WorktreeBranchInfo | null> {
  try {
    const manager = new WorktreeManager(mainRepoPath);
    return await manager.getOriginalBranch(worktreeName);
  } catch {
    return null;
  }
}

/**
 * Pick the remote to recycle against: `origin` when it exists, otherwise the
 * only configured remote. Ambiguity is reported rather than guessed.
 *
 * Exported for testing.
 */
export async function resolveRemote(git: ReturnType<typeof simpleGit>): Promise<string | null> {
  try {
    const remotes = await git.getRemotes(false);
    const names = remotes.map((r) => r.name);
    if (names.includes('origin')) return 'origin';
    if (names.length === 1) return names[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the remote's default branch.
 *
 * Tries local refs first (`origin/HEAD`, then well-known names) so the command
 * still works offline, and only falls back to `ls-remote` when the repository
 * has no local knowledge of the remote.
 */
export async function detectDefaultRemoteBranch(
  git: ReturnType<typeof simpleGit>,
  remote: string
): Promise<string | null> {
  const candidates = ['main', 'master', 'develop', 'dev'];

  // Note: these probes go through gitProbe rather than try/catch. `--quiet` git
  // commands exit non-zero *silently*, and simple-git only reports a command as
  // failed when it writes to stderr - so catching a throw here would never fire
  // and every repository would look like it had the first candidate.

  // 1. Whatever the remote itself says its HEAD is.
  const head = await gitProbe(git, [
    'symbolic-ref',
    '--quiet',
    '--short',
    `refs/remotes/${remote}/HEAD`,
  ]);
  if (head && head.startsWith(`${remote}/`)) {
    return head.substring(remote.length + 1);
  }

  // 2. Known-good names that already exist as remote-tracking refs.
  for (const candidate of candidates) {
    const ref = await gitProbe(git, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/${remote}/${candidate}`,
    ]);
    if (ref) {
      return candidate;
    }
  }

  // 3. Last resort: ask the remote (requires network).
  try {
    const remoteRefs = await git.raw(['ls-remote', '--heads', remote]);
    // Parse each line and extract exact ref names to avoid prefix matching
    // (e.g., "refs/heads/mainline" should not match "main")
    const refNames = new Set(
      remoteRefs
        .trim()
        .split('\n')
        .filter((line) => line.includes('refs/heads/'))
        .map((line) => line.replace(/.*refs\/heads\//, ''))
    );
    for (const candidate of candidates) {
      if (refNames.has(candidate)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function recycleCurrentWorktree(
  resolved: ResolvedWorktree,
  targetBranch: string | undefined,
  options: { yes?: boolean },
  ctx: WorktreeContext
): Promise<void> {
  const { log } = ctx;
  const { info: worktreeInfo } = resolved;

  if (worktreeInfo.branch === '(detached)') {
    log.error('Worktree is in detached HEAD state.');
    log.info("Use 'git checkout <branch>' to switch to a branch first.");
    process.exit(1);
  }

  const git = simpleGit(worktreeInfo.worktreePath);

  const remote = await resolveRemote(git);
  if (!remote) {
    log.error('No usable git remote found (expected `origin`, or exactly one remote).');
    process.exit(1);
  }

  // Resolve the worktree's original branch (the branch it was created for, not the current checkout)
  const original = await getWorktreeOriginalBranch(
    worktreeInfo.mainRepoPath,
    worktreeInfo.worktreeName
  );

  if (!original) {
    log.error('Unable to determine the branch associated with this worktree.');
    process.exit(1);
  }

  const originalBranch = original.branch;

  // Resolve target branch: use provided value, or detect the repo's default branch
  if (!targetBranch) {
    const detected = await detectDefaultRemoteBranch(git, remote);
    if (!detected) {
      log.error('Could not detect default remote branch (tried main, master, develop, dev).');
      log.info('Specify the branch explicitly: workon worktree recycle <branch>');
      process.exit(1);
    }
    targetBranch = detected;
  }

  // Check for uncommitted changes. isClean() also catches conflicted and
  // renamed entries that an explicit bucket list misses.
  if (await worktreeHasChanges(worktreeInfo.worktreePath)) {
    log.error('This worktree has uncommitted changes.');
    log.info('Please commit, stash, or discard your changes before recycling.');
    process.exit(1);
  }

  const alreadyOnBranch = original.exists && worktreeInfo.branch === originalBranch;

  // Confirm the operation
  if (!options.yes) {
    console.log(`\n${chalk.bold('Recycle worktree:')}`);
    console.log(`  Worktree:  ${chalk.cyan(worktreeInfo.worktreeName)}`);
    if (alreadyOnBranch) {
      console.log(`  Branch:    ${chalk.green(originalBranch)} (already on it)`);
    } else if (!original.exists) {
      console.log(`  Current:   ${chalk.yellow(worktreeInfo.branch)}`);
      console.log(`  Recreate:  ${chalk.green(originalBranch)} (branch no longer exists)`);
    } else {
      console.log(`  Current:   ${chalk.yellow(worktreeInfo.branch)}`);
      console.log(`  Switch to: ${chalk.green(originalBranch)}`);
    }
    console.log(`  FF from:   ${chalk.green(`${remote}/${targetBranch}`)}`);
    console.log();

    const shouldProceed = await confirm({
      message: 'Proceed?',
      default: true,
    });

    if (!shouldProceed) {
      log.info('Recycle cancelled.');
      return;
    }
  }

  const spinner = ora('Fetching latest from remote...').start();

  try {
    // Fetch the target branch. A failure here (offline, auth) is not fatal as
    // long as we already have the remote-tracking ref locally - it just means
    // recycling to whatever we last fetched.
    try {
      await git.fetch(remote, targetBranch);
    } catch (fetchError) {
      const hasLocalRef = await gitProbe(git, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/remotes/${remote}/${targetBranch}`,
      ]);

      if (!hasLocalRef) {
        throw fetchError;
      }
      spinner.warn(
        `Could not fetch from '${remote}'; using the last known ${remote}/${targetBranch}.`
      );
      spinner.start();
    }

    if (!original.exists) {
      // The worktree's branch was deleted (usually cleaned up after merging).
      // Recreate it at the target tip so the worktree still ends up on its own
      // branch rather than fast-forwarding whatever the last task left behind.
      // --no-track keeps the new branch from adopting the target as its
      // upstream, which would make a later `git push` here target that branch.
      spinner.text = `Recreating branch '${originalBranch}' at ${remote}/${targetBranch}...`;
      await git.checkout(['--no-track', '-b', originalBranch, `${remote}/${targetBranch}`]);
    } else {
      // Switch to the original branch if not already on it
      if (!alreadyOnBranch) {
        spinner.text = `Switching to branch '${originalBranch}'...`;
        await git.checkout(originalBranch);
      }

      spinner.text = `Fast-forwarding '${originalBranch}' to ${remote}/${targetBranch}...`;

      // Fast-forward to the remote branch tip
      await git.merge([`${remote}/${targetBranch}`, '--ff-only']);
    }

    spinner.succeed(`Recycled! '${originalBranch}' is now at the tip of ${remote}/${targetBranch}`);
    console.log(chalk.green('\nWorktree is ready for the next task.'));
  } catch (error) {
    const message = (error as Error).message;
    spinner.fail('Recycle failed.');

    if (message.includes('ff-only') || message.includes('Not possible to fast-forward')) {
      log.error(
        `Cannot fast-forward '${originalBranch}' to ${remote}/${targetBranch}. ` +
          `The branch has diverged.`
      );
      log.info('You may need to reset or rebase manually.');
    } else if (message.includes('did not match any') || message.includes("couldn't find remote")) {
      log.error(`Remote branch '${remote}/${targetBranch}' not found.`);
    } else {
      log.error(message);
    }
    process.exit(1);
  }
}
