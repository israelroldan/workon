import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';
import type { Config } from '../lib/config.js';
import type { Logger } from '../types/index.js';
import { WorktreeManager } from '../lib/worktree.js';
import { TmuxManager } from '../lib/tmux.js';
import { detectWorktreeContext, type WorktreeInfo } from './worktrees/utils.js';

interface WorktreeContext {
  config: Config;
  log: Logger;
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
    const worktreeInfo = await detectWorktreeContext();

    if (!worktreeInfo) {
      log.error('Not in a git repository.');
      process.exit(1);
    }

    if (!worktreeInfo.isWorktree) {
      log.error("You're in the main repository, not a worktree.");
      log.info(`Use 'workon worktrees' to manage worktrees for this project.`);
      process.exit(1);
    }

    await showWorktreeStatus(worktreeInfo, log);
  });

  // Subcommand: status
  command
    .command('status')
    .description('Show status of the current worktree')
    .action(async () => {
      const worktreeInfo = await detectWorktreeContext();

      if (!worktreeInfo) {
        log.error('Not in a git repository.');
        process.exit(1);
      }

      if (!worktreeInfo.isWorktree) {
        log.error("You're in the main repository, not a worktree.");
        process.exit(1);
      }

      await showWorktreeStatus(worktreeInfo, log);
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
        const worktreeInfo = await detectWorktreeContext();

        if (!worktreeInfo) {
          log.error('Not in a git repository.');
          process.exit(1);
        }

        if (!worktreeInfo.isWorktree) {
          log.error("You're in the main repository, not a worktree.");
          log.info(`Use 'workon worktrees merge <name>' from the main repository.`);
          process.exit(1);
        }

        await mergeCurrentWorktree(worktreeInfo, options, ctx);
      }
    );

  // Subcommand: remove
  command
    .command('remove')
    .description('Remove the current worktree')
    .option('-f, --force', 'Force removal even with uncommitted changes')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options: { force?: boolean; yes?: boolean }) => {
      const worktreeInfo = await detectWorktreeContext();

      if (!worktreeInfo) {
        log.error('Not in a git repository.');
        process.exit(1);
      }

      if (!worktreeInfo.isWorktree) {
        log.error("You're in the main repository, not a worktree.");
        log.info(`Use 'workon worktrees remove <name>' from the main repository.`);
        process.exit(1);
      }

      await removeCurrentWorktree(worktreeInfo, options, ctx);
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
      const worktreeInfo = await detectWorktreeContext();

      if (!worktreeInfo) {
        log.error('Not in a git repository.');
        process.exit(1);
      }

      if (!worktreeInfo.isWorktree) {
        log.error("You're in the main repository, not a worktree.");
        process.exit(1);
      }

      await recycleCurrentWorktree(worktreeInfo, branch, options, ctx);
    });

  return command;
}

async function showWorktreeStatus(worktreeInfo: WorktreeInfo, log: Logger): Promise<void> {
  if (!worktreeInfo.worktreePath) {
    log.error('Unable to determine worktree path.');
    return;
  }

  const git = simpleGit(worktreeInfo.worktreePath);

  // Get git status
  const status = await git.status();
  const hasChanges =
    status.modified.length > 0 ||
    status.not_added.length > 0 ||
    status.deleted.length > 0 ||
    status.staged.length > 0;

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
  }

  console.log(`\n${chalk.bold('Commands:')}`);
  console.log(`  workon worktree merge   - Merge this branch and remove worktree`);
  console.log(`  workon worktree recycle - Reset worktree for the next task`);
  console.log(`  workon worktree remove  - Remove this worktree`);
  console.log();
}

async function mergeCurrentWorktree(
  worktreeInfo: WorktreeInfo,
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

  if (!worktreeInfo.worktreePath || !worktreeInfo.worktreeName) {
    log.error('Unable to determine worktree info.');
    process.exit(1);
  }

  if (worktreeInfo.branch === '(detached)') {
    log.error('Cannot merge a detached HEAD. Create a branch first.');
    log.info(`Use 'git checkout -b <branch-name>' to create a branch.`);
    process.exit(1);
  }

  const manager = new WorktreeManager(worktreeInfo.mainRepoPath);

  // Check for uncommitted changes
  const hasChanges = await manager.hasUncommittedChanges(worktreeInfo.worktreeName);
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
    await manager.merge(worktreeInfo.worktreeName, {
      targetBranch,
      squash: squash || false,
    });
    mergeSpinner.succeed(`Successfully merged '${worktreeInfo.branch}' into '${targetBranch}'`);
  } catch (error) {
    mergeSpinner.fail(`Merge failed: ${(error as Error).message}`);
    log.info('You may need to resolve conflicts manually.');
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
      const sessionName = tmux.getWorktreeSessionName(
        worktreeInfo.mainRepoPath.split('/').pop() || 'project',
        worktreeInfo.worktreeName
      );
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
  worktreeInfo: WorktreeInfo,
  options: { force?: boolean; yes?: boolean },
  ctx: WorktreeContext
): Promise<void> {
  const { log } = ctx;

  if (!worktreeInfo.worktreePath || !worktreeInfo.worktreeName) {
    log.error('Unable to determine worktree info.');
    process.exit(1);
  }

  const manager = new WorktreeManager(worktreeInfo.mainRepoPath);

  // Check for uncommitted changes
  const hasChanges = await manager.hasUncommittedChanges(worktreeInfo.worktreeName);
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
 * We cannot rely on the `branch` field from `git worktree list --porcelain`
 * because that reflects the *currently checked-out* branch, which may have
 * changed (e.g., after `worktrees branch feat-x pr-branch`).
 *
 * Instead, we use the WorktreeManager which created the worktree: worktree
 * names are derived from branches via `branchToDir()` (slashes → hyphens).
 * We look up the worktree by name and get its original branch from the
 * manager's data, which cross-references the worktree path against
 * `git worktree list` and the managed worktrees directory.
 */
async function getWorktreeOriginalBranch(
  mainRepoPath: string,
  worktreeName: string
): Promise<string | null> {
  try {
    const manager = new WorktreeManager(mainRepoPath);
    const worktree = await manager.get(worktreeName);
    if (worktree && worktree.branch && worktree.branch !== '(detached)') {
      return worktree.branch;
    }

    // Fallback: check all local branches for one whose branchToDir form
    // matches the worktree name (handles external worktrees)
    const git = simpleGit(mainRepoPath);
    const branches = await git.branchLocal();
    for (const branchName of branches.all) {
      if (branchName.replace(/\//g, '-') === worktreeName) {
        return branchName;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the default remote branch (main, master, develop, dev) by checking
 * which ones exist as remote tracking branches.
 */
async function detectDefaultRemoteBranch(
  git: ReturnType<typeof simpleGit>
): Promise<string | null> {
  const candidates = ['main', 'master', 'develop', 'dev'];
  try {
    const remoteRefs = await git.raw(['ls-remote', '--heads', 'origin']);
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
  worktreeInfo: WorktreeInfo,
  targetBranch: string | undefined,
  options: { yes?: boolean },
  ctx: WorktreeContext
): Promise<void> {
  const { log } = ctx;

  if (!worktreeInfo.worktreePath || !worktreeInfo.worktreeName) {
    log.error('Unable to determine worktree info.');
    process.exit(1);
  }

  if (worktreeInfo.branch === '(detached)') {
    log.error('Worktree is in detached HEAD state.');
    log.info("Use 'git checkout <branch>' to switch to a branch first.");
    process.exit(1);
  }

  const git = simpleGit(worktreeInfo.worktreePath);

  // Resolve the worktree's original branch (the branch it was created for, not the current checkout)
  const originalBranch = await getWorktreeOriginalBranch(
    worktreeInfo.mainRepoPath,
    worktreeInfo.worktreeName
  );

  if (!originalBranch) {
    log.error('Unable to determine the branch associated with this worktree.');
    process.exit(1);
  }

  // Resolve target branch: use provided value, or detect the repo's default branch
  if (!targetBranch) {
    const detected = await detectDefaultRemoteBranch(git);
    if (!detected) {
      log.error('Could not detect default remote branch (tried main, master, develop, dev).');
      log.info('Specify the branch explicitly: workon worktree recycle <branch>');
      process.exit(1);
    }
    targetBranch = detected;
  }

  // Check for uncommitted changes
  const status = await git.status();
  const hasChanges =
    status.modified.length > 0 ||
    status.not_added.length > 0 ||
    status.deleted.length > 0 ||
    status.staged.length > 0 ||
    status.created.length > 0 ||
    status.renamed.length > 0 ||
    status.conflicted.length > 0;

  if (hasChanges) {
    log.error('This worktree has uncommitted changes.');
    log.info('Please commit, stash, or discard your changes before recycling.');
    process.exit(1);
  }

  const alreadyOnBranch = worktreeInfo.branch === originalBranch;

  // Confirm the operation
  if (!options.yes) {
    console.log(`\n${chalk.bold('Recycle worktree:')}`);
    console.log(`  Worktree:  ${chalk.cyan(worktreeInfo.worktreeName)}`);
    if (alreadyOnBranch) {
      console.log(`  Branch:    ${chalk.green(originalBranch)} (already on it)`);
    } else {
      console.log(`  Current:   ${chalk.yellow(worktreeInfo.branch)}`);
      console.log(`  Switch to: ${chalk.green(originalBranch)}`);
    }
    console.log(`  FF from:   ${chalk.green(`origin/${targetBranch}`)}`);
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
    // Fetch the target branch from remote
    await git.fetch('origin', targetBranch);

    // Switch to the original branch if not already on it
    if (!alreadyOnBranch) {
      spinner.text = `Switching to branch '${originalBranch}'...`;
      await git.checkout(originalBranch);
    }

    spinner.text = `Fast-forwarding '${originalBranch}' to origin/${targetBranch}...`;

    // Fast-forward to the remote branch tip
    await git.merge([`origin/${targetBranch}`, '--ff-only']);

    spinner.succeed(`Recycled! '${originalBranch}' is now at the tip of origin/${targetBranch}`);
    console.log(chalk.green('\nWorktree is ready for the next task.'));
  } catch (error) {
    const message = (error as Error).message;
    spinner.fail('Recycle failed.');

    if (message.includes('ff-only')) {
      log.error(
        `Cannot fast-forward '${originalBranch}' to origin/${targetBranch}. ` +
          `The branch has diverged.`
      );
      log.info('You may need to reset or rebase manually.');
    } else if (message.includes('did not match any')) {
      log.error(`Remote branch 'origin/${targetBranch}' not found.`);
    } else {
      log.error(message);
    }
    process.exit(1);
  }
}
