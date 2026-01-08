import { Command } from 'commander';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';

interface ConfigContext {
  config: Config;
  log: Logger;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

export function createListCommand(ctx: ConfigContext): Command {
  const { config, log } = ctx;

  return new Command('list').description('List configuration parameters').action(() => {
    log.debug('Listing configuration');

    console.log(`Configuration file: ${config.path}\n`);

    const store = config.store;
    const flattened = flattenObject(store as unknown as Record<string, unknown>);

    for (const [key, value] of Object.entries(flattened)) {
      const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`${key}: ${displayValue}`);
    }
  });
}
