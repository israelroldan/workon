import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { resolveProjectPath } from './utils.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

interface BranchOptions {
  push?: boolean;
  force?: boolean;
}

export function createBranchCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('branch')
    .description('Create a branch from a worktree (useful for detached HEAD state)')
    .argument('<project>', 'Project name')
    .argument('<worktree>', 'Worktree name')
    .argument('<branch>', 'New branch name to create')
    .option('-p, --push', 'Push the branch to origin after creating')
    .option('-f, --force', 'Overwrite existing branch')
    .action(
      async (project: string, worktreeName: string, branchName: string, options: BranchOptions) => {
        const projectPath = resolveProjectPath(project, config, log);
        if (!projectPath) {
          process.exit(1);
        }

        const manager = new WorktreeManager(projectPath);

        if (!(await manager.isGitRepository())) {
          log.error(`'${project}' is not a git repository`);
          process.exit(1);
        }

        const worktree = await manager.get(worktreeName);
        if (!worktree) {
          log.error(`Worktree '${worktreeName}' not found for project '${project}'`);
          const worktrees = await manager.list();
          const nonMain = worktrees.filter((wt) => !wt.isMain);
          if (nonMain.length > 0) {
            log.info('Available worktrees:');
            nonMain.forEach((wt) => log.info(`  - ${wt.name} (${wt.branch})`));
          }
          process.exit(1);
        }

        const worktreeGit = simpleGit(worktree.path);

        // Check if branch already exists
        const branchExists = await manager.branchExists(branchName);
        if (branchExists && !options.force) {
          log.error(`Branch '${branchName}' already exists. Use --force to overwrite.`);
          process.exit(1);
        }

        const isDetached = worktree.branch === '(detached)';

        console.log(`\n${chalk.bold('Worktree status:')}`);
        console.log(`  Name:   ${chalk.cyan(worktree.name)}`);
        console.log(
          `  State:  ${isDetached ? chalk.yellow('detached HEAD') : chalk.green(worktree.branch)}`
        );
        console.log(`  HEAD:   ${chalk.gray(worktree.head.substring(0, 8))}`);
        console.log(`\n${chalk.bold('Action:')}`);
        console.log(`  Create branch: ${chalk.green(branchName)}`);
        if (options.push) {
          console.log(`  Push to:       ${chalk.cyan('origin/' + branchName)}`);
        }
        console.log();

        const spinner = ora(`Creating branch '${branchName}'...`).start();

        try {
          // Create the branch at current HEAD
          if (options.force && branchExists) {
            // Delete and recreate
            await worktreeGit.branch(['-D', branchName]);
          }
          await worktreeGit.checkoutLocalBranch(branchName);

          spinner.succeed(`Branch '${branchName}' created and checked out`);

          // Push if requested
          if (options.push) {
            const pushSpinner = ora(`Pushing to origin/${branchName}...`).start();
            try {
              await worktreeGit.push('origin', branchName, ['--set-upstream']);
              pushSpinner.succeed(`Pushed to origin/${branchName}`);

              console.log(
                chalk.green('\nReady for PR! You can now create a pull request from this branch.')
              );
            } catch (error) {
              pushSpinner.fail(`Failed to push: ${(error as Error).message}`);
              log.info(`You can push manually with: git push -u origin ${branchName}`);
            }
          } else {
            const shouldPush = await confirm({
              message: 'Push branch to origin for PR?',
              default: true,
            });

            if (shouldPush) {
              const pushSpinner = ora(`Pushing to origin/${branchName}...`).start();
              try {
                await worktreeGit.push('origin', branchName, ['--set-upstream']);
                pushSpinner.succeed(`Pushed to origin/${branchName}`);

                console.log(
                  chalk.green('\nReady for PR! You can now create a pull request from this branch.')
                );
              } catch (error) {
                pushSpinner.fail(`Failed to push: ${(error as Error).message}`);
                log.info(`You can push manually with: git push -u origin ${branchName}`);
              }
            }
          }
        } catch (error) {
          spinner.fail(`Failed to create branch: ${(error as Error).message}`);
          process.exit(1);
        }
      }
    );
}
