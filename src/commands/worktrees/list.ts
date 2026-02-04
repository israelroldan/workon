import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { resolveProjectFromCwd } from './utils.js';
import { blockIfInWorktree } from './index.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

export function createListCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('list')
    .description('List worktrees for the current project')
    .option('-a, --all', 'Show all worktrees (including main)')
    .action(async (options: { all?: boolean }) => {
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

      const allWorktrees = await manager.list();
      const managedWorktrees = await manager.listManagedWorktrees();
      const managedPaths = new Set(managedWorktrees.map((wt) => wt.path));

      const worktrees = options.all ? allWorktrees : allWorktrees.filter((wt) => !wt.isMain);

      if (worktrees.length === 0) {
        if (options.all) {
          log.info('No worktrees found.');
        } else {
          log.info(`No worktrees found for '${displayName}'.`);
          log.info(`Use 'workon worktrees add <branch>' to create one.`);
        }
        return;
      }

      console.log(chalk.bold(`\nWorktrees for ${displayName}:`));
      console.log('-'.repeat(60));

      for (const wt of worktrees) {
        const isManaged = managedPaths.has(wt.path);
        const mainLabel = wt.isMain ? chalk.gray(' (main)') : '';
        const externalLabel = !wt.isMain && !isManaged ? chalk.yellow(' (external)') : '';
        const branchDisplay =
          wt.branch === '(detached)' ? chalk.yellow(wt.branch) : chalk.green(wt.branch);

        console.log(`  ${chalk.cyan(wt.name)}${mainLabel}${externalLabel}`);
        console.log(`    Branch: ${branchDisplay}`);
        console.log(`    Path:   ${chalk.gray(wt.path)}`);
        console.log(`    HEAD:   ${chalk.gray(wt.head.substring(0, 8))}`);
        console.log();
      }
    });
}
