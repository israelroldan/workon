import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';

interface ConfigContext {
  config: Config;
  log: Logger;
}

export function createUnsetCommand(ctx: ConfigContext): Command {
  const { config, log } = ctx;

  return new Command('unset')
    .description('Remove a configuration parameter')
    .argument('<key>', 'The configuration parameter to remove')
    .option('--silent', 'Suppress console output')
    .action((key: string, options: { silent?: boolean }) => {
      log.debug(`Removing ${key}`);

      if (config.has(key)) {
        config.delete(key);
        if (!options.silent) {
          console.log(`Removed ${key}`);
        }
      } else {
        if (!options.silent) {
          console.log(`Key ${key} not found`);
        }
      }
    });
}
