import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { resolveProjectFromCwd, promptToRegisterProject, type ProjectContext } from './utils.js';
import { blockIfInWorktree } from './index.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

interface AddOptions {
  base?: string;
  force?: boolean;
  open?: boolean;
  hook?: boolean; // Commander negated options: --no-hook sets hook=false
  yes?: boolean;
}

export function createAddCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('add')
    .description('Create a new worktree for a branch')
    .argument('<branch>', 'Branch name for the worktree')
    .option('-b, --base <branch>', 'Base branch to create new branch from')
    .option('-f, --force', 'Overwrite existing worktree')
    .option('-o, --open', 'Open the worktree after creation')
    .option('--no-hook', 'Skip running the post-setup hook')
    .option('-y, --yes', 'Skip all confirmation prompts (non-interactive mode)')
    .action(async (branch: string, options: AddOptions) => {
      const projectCtx = await resolveProjectFromCwd(config, log);

      if (!projectCtx) {
        log.error('Not in a git repository. Run this command from within a git project.');
        process.exit(1);
      }

      // Block if running from inside a worktree
      if (blockIfInWorktree(projectCtx, log)) {
        process.exit(1);
      }

      // For full functionality (open session), we need registration
      if (!projectCtx.isRegistered) {
        if (options.yes) {
          log.info('Project is not registered. Proceeding without registration.');
        } else {
          const result = await promptToRegisterProject(projectCtx.projectPath, config, log);
          if (result) {
            projectCtx.projectName = result.projectName;
            projectCtx.projectConfig = result.projectConfig;
            projectCtx.isRegistered = true;
          }
        }
      }

      const { projectPath, projectName } = projectCtx;
      const manager = new WorktreeManager(projectPath, projectName ?? undefined);

      // If no base branch specified and branch doesn't exist, ask user
      const branchExists = await manager.branchExists(branch);
      let baseBranch = options.base;

      if (!branchExists && !baseBranch) {
        if (options.yes) {
          baseBranch = await manager.getCurrentBranch();
          log.info(`Branch '${branch}' doesn't exist. Creating from '${baseBranch}'.`);
        } else {
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
      }

      // A --force replace destroys the existing worktree's directory. Give the
      // user a chance to bail before it takes uncommitted work with it.
      if (options.force) {
        const existing = await manager.get(manager.branchToDir(branch));
        if (existing && !existing.isMain && (await manager.hasUncommittedChanges(existing.path))) {
          log.warn(`Worktree '${existing.name}' has uncommitted changes at ${existing.path}.`);
          if (options.yes) {
            log.error('Refusing to overwrite it. Commit, stash, or remove it explicitly first.');
            process.exit(1);
          }
          const shouldReplace = await confirm({
            message: 'Replace it anyway and lose those changes?',
            default: false,
          });
          if (!shouldReplace) {
            log.info('Cancelled.');
            return;
          }
          await manager.remove(existing.name, true);
        }
      }

      const spinner = ora(`Creating worktree for branch '${branch}'...`).start();

      try {
        const worktree = await manager.add({
          branch,
          baseBranch,
          force: options.force,
        });

        spinner.succeed(`Worktree created at ${chalk.cyan(worktree.path)}`);

        // Run post-setup hook if it exists and not disabled (--no-hook sets options.hook=false)
        if (options.hook !== false && manager.hasSetupHook()) {
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

        // Ask to open if --open flag or prompt (only if registered)
        if (projectCtx.isRegistered && projectName) {
          if (options.open) {
            await openWorktreeSession(projectCtx, worktree.name, config, log);
          } else if (options.yes) {
            console.log(`\nTo open later: ${chalk.cyan(`workon worktrees open ${worktree.name}`)}`);
          } else {
            const shouldOpen = await confirm({
              message: 'Open workon session in this worktree?',
              default: true,
            });

            if (shouldOpen) {
              await openWorktreeSession(projectCtx, worktree.name, config, log);
            } else {
              console.log(
                `\nTo open later: ${chalk.cyan(`workon worktrees open ${worktree.name}`)}`
              );
            }
          }
        } else {
          console.log(
            `\n${chalk.yellow('Note:')} Register this project to enable full workon sessions.`
          );
          console.log(`  cd ${worktree.path}`);
        }
      } catch (error) {
        spinner.fail(`Failed to create worktree: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}

async function openWorktreeSession(
  projectCtx: ProjectContext,
  worktreeName: string,
  config: Config,
  log: Logger
): Promise<void> {
  if (!projectCtx.projectName) {
    log.warn('Cannot open session: project is not registered.');
    return;
  }
  // Import and call the open worktree command logic
  const { runWorktreeOpen } = await import('./open.js');
  await runWorktreeOpen(projectCtx, worktreeName, {}, { config, log });
}
