import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { existsSync } from 'fs';
import { confirm } from '@inquirer/prompts';
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

interface RemoveOptions {
  force?: boolean;
  yes?: boolean;
  hook?: boolean; // Commander negated options: --no-hook sets hook=false
}

export function createRemoveCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('remove')
    .description('Remove a worktree')
    .argument('<name>', 'Worktree name')
    .option('-f, --force', 'Force removal even with uncommitted changes')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--no-hook', 'Skip running the pre-teardown hook')
    .action(async (name: string, options: RemoveOptions) => {
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
      const manager = new WorktreeManager(projectPath, projectName ?? undefined);

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
        log.error('Cannot remove the main worktree');
        process.exit(1);
      }

      // Check if worktree directory exists on disk
      const pathMissing = !existsSync(worktree.path);
      if (pathMissing) {
        log.warn(`Worktree directory is missing from disk: ${worktree.path}`);
        // Force removal since git requires --force for missing directories
        options.force = true;
      }

      // Check for uncommitted changes (skip if directory is missing)
      if (!pathMissing) {
        const hasChanges = await manager.hasUncommittedChanges(name);
        if (hasChanges && !options.force) {
          log.warn(`Worktree '${name}' has uncommitted changes.`);

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
      }

      // Confirm removal
      if (!options.yes) {
        console.log(`\n${chalk.bold('Worktree to remove:')}`);
        console.log(`  Name:   ${chalk.cyan(worktree.name)}`);
        console.log(`  Branch: ${chalk.green(worktree.branch)}`);
        console.log(`  Path:   ${chalk.gray(worktree.path)}`);
        console.log();

        const shouldRemove = await confirm({
          message: `Remove worktree '${name}'?`,
          default: true,
        });

        if (!shouldRemove) {
          log.info('Removal cancelled.');
          return;
        }
      }

      // Kill any associated tmux session
      const tmux = new TmuxManager();
      const sessionName = tmux.getWorktreeSessionName(displayName, name);
      if (await tmux.sessionExists(sessionName)) {
        log.debug(`Killing tmux session: ${sessionName}`);
        await tmux.killSession(sessionName);
      }

      // Run pre-teardown hook if it exists and not disabled
      if (options.hook !== false && !pathMissing && manager.hasTeardownHook()) {
        const hookSpinner = ora('Running pre-teardown hook...').start();
        try {
          const { stdout, stderr } = await manager.runPreTeardownHook(worktree.path);
          hookSpinner.succeed('Pre-teardown hook completed');
          if (stdout.trim()) {
            console.log(chalk.gray(stdout.trim()));
          }
          if (stderr.trim()) {
            console.log(chalk.yellow(stderr.trim()));
          }
        } catch (error) {
          hookSpinner.warn(`Pre-teardown hook failed: ${(error as Error).message}`);
        }
      }

      const spinner = ora(`Removing worktree '${name}'...`).start();

      try {
        await manager.remove(name, options.force);
        spinner.succeed(`Worktree '${name}' removed successfully`);
      } catch (error) {
        spinner.fail(`Failed to remove worktree: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
