import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';
import { createListCommand } from './list.js';
import { createSetCommand } from './set.js';
import { createUnsetCommand } from './unset.js';

interface ConfigContext {
  config: Config;
  log: Logger;
}

export function createConfigCommand(ctx: ConfigContext): Command {
  const command = new Command('config').description('Manage configuration parameters');

  command.addCommand(createListCommand(ctx));
  command.addCommand(createSetCommand(ctx));
  command.addCommand(createUnsetCommand(ctx));

  // Default action shows list
  command.action(() => {
    command.commands.find((c) => c.name() === 'list')?.parse();
  });

  return command;
}
