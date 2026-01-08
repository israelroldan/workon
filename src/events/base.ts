import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventTmux,
  EventHelp,
  EventHandler,
} from '../types/index.js';

/**
 * Base event class that all events should extend
 * Provides default implementations for required interfaces
 */
export abstract class BaseEvent implements EventHandler {
  static get metadata(): EventMetadata {
    throw new Error('Event must implement static metadata getter');
  }

  get metadata(): EventMetadata {
    return (this.constructor as typeof BaseEvent).metadata;
  }

  static get validation(): EventValidation {
    return {
      validateConfig(_config: unknown): true | string {
        return true; // Default: accept any config
      },
    };
  }

  get validation(): EventValidation {
    return (this.constructor as typeof BaseEvent).validation;
  }

  static get configuration(): EventConfiguration {
    return {
      async configureInteractive(): Promise<unknown> {
        return true; // Default: simple boolean enable
      },
      getDefaultConfig(): unknown {
        return true;
      },
    };
  }

  get configuration(): EventConfiguration {
    return (this.constructor as typeof BaseEvent).configuration;
  }

  static get processing(): EventProcessing {
    return {
      async processEvent(_context): Promise<void> {
        throw new Error('Event must implement processEvent method');
      },
      generateShellCommand(_context): string[] {
        return [];
      },
    };
  }

  get processing(): EventProcessing {
    return (this.constructor as typeof BaseEvent).processing;
  }

  static get tmux(): EventTmux | null {
    return null; // Default: no tmux integration
  }

  get tmux(): EventTmux | null {
    return (this.constructor as typeof BaseEvent).tmux;
  }

  static get help(): EventHelp {
    const meta = this.metadata;
    return {
      usage: `${meta.name}: <configuration>`,
      description: meta.description,
      examples: [],
    };
  }

  get help(): EventHelp {
    return (this.constructor as typeof BaseEvent).help;
  }
}
