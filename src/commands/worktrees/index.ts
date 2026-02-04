import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { createListCommand } from './list.js';
import { createAddCommand } from './add.js';
import { createOpenCommand } from './open.js';
import { createRemoveCommand } from './remove.js';
import { createMergeCommand } from './merge.js';
import { createBranchCommand } from './branch.js';
import { resolveProjectFromCwd, promptToRegisterProject } from './utils.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

export function createWorktreesCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  const command = new Command('worktrees').description(
    'Manage git worktrees for the current project (run from within a git repository)'
  );

  command.addCommand(createListCommand(ctx));
  command.addCommand(createAddCommand(ctx));
  command.addCommand(createOpenCommand(ctx));
  command.addCommand(createRemoveCommand(ctx));
  command.addCommand(createMergeCommand(ctx));
  command.addCommand(createBranchCommand(ctx));

  // Default action: show interactive menu
  command.action(async () => {
    const projectCtx = await resolveProjectFromCwd(config, log);

    if (!projectCtx) {
      log.error('Not in a git repository. Run this command from within a git project.');
      process.exit(1);
    }

    // If unregistered, prompt to register
    if (!projectCtx.isRegistered) {
      const result = await promptToRegisterProject(projectCtx.projectPath, config, log);
      if (!result) {
        log.info(`Tip: You can run 'workon add .' to register this project later.`);
        process.exit(0);
      }
      projectCtx.projectName = result.projectName;
      projectCtx.projectConfig = result.projectConfig;
      projectCtx.isRegistered = true;
    }

    // Show interactive menu
    const { manageWorktreesInteractive } = await import('../interactive.js');
    await manageWorktreesInteractive(projectCtx, ctx);
  });

  return command;
}
