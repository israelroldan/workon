import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { resolveProjectPath } from './utils.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

interface AddOptions {
  base?: string;
  force?: boolean;
  open?: boolean;
  noHook?: boolean;
}

export function createAddCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('add')
    .description('Create a new worktree for a branch')
    .argument('<project>', 'Project name')
    .argument('<branch>', 'Branch name for the worktree')
    .option('-b, --base <branch>', 'Base branch to create new branch from')
    .option('-f, --force', 'Overwrite existing worktree')
    .option('-o, --open', 'Open the worktree after creation')
    .option('--no-hook', 'Skip running the post-setup hook')
    .action(async (project: string, branch: string, options: AddOptions) => {
      const projectPath = resolveProjectPath(project, config, log);
      if (!projectPath) {
        process.exit(1);
      }

      const manager = new WorktreeManager(projectPath);

      if (!(await manager.isGitRepository())) {
        log.error(`'${project}' is not a git repository`);
        process.exit(1);
      }

      // If no base branch specified and branch doesn't exist, ask user
      const branchExists = await manager.branchExists(branch);
      let baseBranch = options.base;

      if (!branchExists && !baseBranch) {
        const branches = await manager.getBranches();
        const currentBranch = await manager.getCurrentBranch();

        baseBranch = await select({
          message: `Branch '${branch}' doesn't exist. Create from which branch?`,
          choices: branches.map((b) => ({
            name: b === currentBranch ? `${b} (current)` : b,
            value: b,
          })),
          default: currentBranch,
        });
      }

      const spinner = ora(`Creating worktree for branch '${branch}'...`).start();

      try {
        const worktree = await manager.add({
          branch,
          baseBranch,
          force: options.force,
        });

        spinner.succeed(`Worktree created at ${chalk.cyan(worktree.path)}`);

        // Run post-setup hook if it exists and not disabled
        if (options.noHook !== true && manager.hasSetupHook()) {
          const hookSpinner = ora('Running post-setup hook...').start();
          try {
            const { stdout, stderr } = await manager.runPostSetupHook(worktree.path);
            hookSpinner.succeed('Post-setup hook completed');
            if (stdout.trim()) {
              console.log(chalk.gray(stdout.trim()));
            }
            if (stderr.trim()) {
              console.log(chalk.yellow(stderr.trim()));
            }
          } catch (error) {
            hookSpinner.warn(`Post-setup hook failed: ${(error as Error).message}`);
          }
        }

        console.log(`\n${chalk.bold('Worktree details:')}`);
        console.log(`  Name:   ${chalk.cyan(worktree.name)}`);
        console.log(`  Branch: ${chalk.green(worktree.branch)}`);
        console.log(`  Path:   ${chalk.gray(worktree.path)}`);

        // Ask to open if --open flag or prompt
        if (options.open) {
          await openWorktreeSession(project, worktree.name, config, log);
        } else {
          const shouldOpen = await confirm({
            message: 'Open workon session in this worktree?',
            default: true,
          });

          if (shouldOpen) {
            await openWorktreeSession(project, worktree.name, config, log);
          } else {
            console.log(
              `\nTo open later: ${chalk.cyan(`workon worktrees ${project} open ${worktree.name}`)}`
            );
          }
        }
      } catch (error) {
        spinner.fail(`Failed to create worktree: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}

async function openWorktreeSession(
  project: string,
  worktreeName: string,
  config: Config,
  log: Logger
): Promise<void> {
  // Import and call the open worktree command logic
  const { runWorktreeOpen } = await import('./open.js');
  await runWorktreeOpen(project, worktreeName, {}, { config, log });
}
