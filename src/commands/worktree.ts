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

    targetBranch = await select({
      message: `Merge '${worktreeInfo.branch}' into which branch?`,
      choices: targetBranches.map((b) => ({ name: b, value: b })),
      default: defaultTarget,
    });
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
