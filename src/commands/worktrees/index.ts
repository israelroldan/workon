import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { createListCommand } from './list.js';
import { createAddCommand } from './add.js';
import { createOpenCommand } from './open.js';
import { createRemoveCommand } from './remove.js';
import { createMergeCommand } from './merge.js';
import { createBranchCommand } from './branch.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

export function createWorktreesCommand(ctx: WorktreesContext): Command {
  const command = new Command('worktrees')
    .description('Manage git worktrees for projects')
    .argument('<project>', 'Project name');

  command.addCommand(createListCommand(ctx));
  command.addCommand(createAddCommand(ctx));
  command.addCommand(createOpenCommand(ctx));
  command.addCommand(createRemoveCommand(ctx));
  command.addCommand(createMergeCommand(ctx));
  command.addCommand(createBranchCommand(ctx));

  // Default action: show list
  command.action(async (project: string) => {
    // Manually invoke list command with the project
    const listCmd = command.commands.find((c) => c.name() === 'list');
    if (listCmd) {
      await listCmd.parseAsync([project], { from: 'user' });
    }
  });

  return command;
}
