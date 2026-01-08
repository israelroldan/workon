import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';

interface ConfigContext {
  config: Config;
  log: Logger;
}

export function createSetCommand(ctx: ConfigContext): Command {
  const { config, log } = ctx;

  return new Command('set')
    .description('Set a configuration parameter')
    .argument('<key>', 'The configuration parameter to set')
    .argument('<value>', 'The value to set')
    .action((key: string, value: string) => {
      log.debug(`Setting ${key} to ${value}`);

      // Try to parse as JSON if possible
      let parsedValue: unknown = value;
      try {
        // Handle booleans
        if (value === 'true') {
          parsedValue = true;
        } else if (value === 'false') {
          parsedValue = false;
        } else if (!isNaN(Number(value)) && value.trim() !== '') {
          // Handle numbers
          parsedValue = Number(value);
        } else {
          // Try JSON parse for objects/arrays
          parsedValue = JSON.parse(value);
        }
      } catch {
        // Keep as string if not valid JSON
        parsedValue = value;
      }

      config.set(key, parsedValue);
      console.log(
        `Set ${key} = ${typeof parsedValue === 'object' ? JSON.stringify(parsedValue) : parsedValue}`
      );
    });
}
