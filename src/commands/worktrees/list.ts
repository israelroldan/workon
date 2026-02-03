import { Command } from 'commander';
import chalk from 'chalk';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { resolveProjectPath } from './utils.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

export function createListCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('list')
    .description('List worktrees for a project')
    .argument('<project>', 'Project name')
    .option('-a, --all', 'Show all worktrees (including main)')
    .action(async (project: string, options: { all?: boolean }) => {
      const projectPath = resolveProjectPath(project, config, log);
      if (!projectPath) {
        process.exit(1);
      }

      const manager = new WorktreeManager(projectPath);

      if (!(await manager.isGitRepository())) {
        log.error(`'${project}' is not a git repository`);
        process.exit(1);
      }

      const allWorktrees = await manager.list();
      const managedWorktrees = await manager.listManagedWorktrees();
      const managedPaths = new Set(managedWorktrees.map((wt) => wt.path));

      const worktrees = options.all ? allWorktrees : allWorktrees.filter((wt) => !wt.isMain);

      if (worktrees.length === 0) {
        if (options.all) {
          log.info('No worktrees found.');
        } else {
          log.info(`No worktrees found for project '${project}'.`);
          log.info(`Use 'workon worktrees ${project} add <branch>' to create one.`);
        }
        return;
      }

      console.log(chalk.bold(`\nWorktrees for ${project}:`));
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
