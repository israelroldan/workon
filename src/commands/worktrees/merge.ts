import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { select, confirm } from '@inquirer/prompts';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { TmuxManager } from '../../lib/tmux.js';
import { resolveProjectFromCwd } from './utils.js';
import { blockIfInWorktree } from './index.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

interface MergeOptions {
  into?: string;
  squash?: boolean;
  keep?: boolean;
  yes?: boolean;
}

export function createMergeCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('merge')
    .description('Merge a worktree branch and optionally remove the worktree')
    .argument('<name>', 'Worktree name')
    .option('-i, --into <branch>', 'Target branch to merge into')
    .option('-s, --squash', 'Use squash merge')
    .option('-k, --keep', 'Keep the worktree after merging')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (name: string, options: MergeOptions) => {
      const projectCtx = await resolveProjectFromCwd(config, log);

      if (!projectCtx) {
        log.error('Not in a git repository. Run this command from within a git project.');
        process.exit(1);
      }

      // Block if running from inside a worktree
      if (blockIfInWorktree(projectCtx, log)) {
        process.exit(1);
      }

      const { projectPath, projectName } = projectCtx;
      const displayName = projectName || path.basename(projectPath);
      const manager = new WorktreeManager(projectPath);

      const worktree = await manager.get(name);
      if (!worktree) {
        log.error(`Worktree '${name}' not found for '${displayName}'`);
        const worktrees = await manager.listManagedWorktrees();
        if (worktrees.length > 0) {
          log.info('Available worktrees:');
          worktrees.forEach((wt) => log.info(`  - ${wt.name}`));
        }
        process.exit(1);
      }

      if (worktree.isMain) {
        log.error('Cannot merge the main worktree');
        process.exit(1);
      }

      // Check for uncommitted changes
      const hasChanges = await manager.hasUncommittedChanges(name);
      if (hasChanges) {
        log.error(`Worktree '${name}' has uncommitted changes.`);
        log.info('Please commit or stash your changes before merging.');
        process.exit(1);
      }

      // Select target branch
      let targetBranch = options.into;
      if (!targetBranch) {
        const branches = await manager.getBranches();
        // Filter out the worktree's branch
        const targetBranches = branches.filter((b) => b !== worktree.branch);

        if (targetBranches.length === 0) {
          log.error('No other branches available to merge into.');
          process.exit(1);
        }

        // Try to find common target branches
        const commonTargets = ['main', 'master', 'develop', 'dev'];
        const defaultTarget =
          commonTargets.find((t) => targetBranches.includes(t)) || targetBranches[0];

        targetBranch = await select({
          message: `Merge '${worktree.branch}' into which branch?`,
          choices: targetBranches.map((b) => ({
            name: b,
            value: b,
          })),
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
        console.log(`  Source:  ${chalk.green(worktree.branch)}`);
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
      const mergeSpinner = ora(`Merging '${worktree.branch}' into '${targetBranch}'...`).start();

      try {
        await manager.merge(name, {
          targetBranch,
          squash: squash || false,
        });
        mergeSpinner.succeed(`Successfully merged '${worktree.branch}' into '${targetBranch}'`);
      } catch (error) {
        mergeSpinner.fail(`Merge failed: ${(error as Error).message}`);
        log.info('You may need to resolve conflicts manually.');
        process.exit(1);
      }

      // Remove worktree if not keeping
      if (!options.keep) {
        // Kill any associated tmux session
        const tmux = new TmuxManager();
        const sessionName = tmux.getWorktreeSessionName(displayName, name);
        if (await tmux.sessionExists(sessionName)) {
          log.debug(`Killing tmux session: ${sessionName}`);
          await tmux.killSession(sessionName);
        }

        const removeSpinner = ora(`Removing worktree '${name}'...`).start();

        try {
          await manager.remove(name, true);
          removeSpinner.succeed(`Worktree '${name}' removed`);
        } catch (error) {
          removeSpinner.warn(`Failed to remove worktree: ${(error as Error).message}`);
          log.info(`You can remove it manually with: workon worktrees remove ${name}`);
        }

        // Optionally delete the branch
        if (!options.yes) {
          const shouldDeleteBranch = await confirm({
            message: `Delete the merged branch '${worktree.branch}'?`,
            default: false,
          });

          if (shouldDeleteBranch) {
            const deleteSpinner = ora(`Deleting branch '${worktree.branch}'...`).start();
            try {
              const { simpleGit } = await import('simple-git');
              const git = simpleGit(projectPath);
              await git.deleteLocalBranch(worktree.branch, true);
              deleteSpinner.succeed(`Branch '${worktree.branch}' deleted`);
            } catch (error) {
              deleteSpinner.warn(`Failed to delete branch: ${(error as Error).message}`);
            }
          }
        }
      }

      console.log(chalk.green('\nMerge workflow completed successfully!'));
    });
}
