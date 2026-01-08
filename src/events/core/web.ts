import { spawn } from 'child_process';
import { platform } from 'os';
import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventHelp,
  EventProcessingContext,
} from '../../types/index.js';

export class WebEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'web',
      displayName: 'Open homepage in browser',
      description: 'Open project homepage in web browser',
      category: 'core',
      requiresTmux: false,
      dependencies: [],
    };
  }

  static get validation(): EventValidation {
    return {
      validateConfig(config: unknown): true | string {
        if (typeof config === 'boolean' || config === 'true' || config === 'false') {
          return true;
        }
        return 'web config must be a boolean (true/false)';
      },
    };
  }

  static get configuration(): EventConfiguration {
    return {
      async configureInteractive(): Promise<boolean> {
        return true;
      },
      getDefaultConfig(): boolean {
        return true;
      },
    };
  }

  static getOpenCommand(): string {
    const os = platform();
    switch (os) {
      case 'darwin':
        return 'open';
      case 'win32':
        return 'start';
      default:
        return 'xdg-open';
    }
  }

  static get processing(): EventProcessing {
    return {
      async processEvent(context: EventProcessingContext): Promise<void> {
        const { project, isShellMode, shellCommands } = context;
        const homepage = project.homepage;

        if (!homepage) {
          console.warn('No homepage configured for project');
          return;
        }

        const openCmd = WebEvent.getOpenCommand();

        if (isShellMode) {
          shellCommands.push(`${openCmd} "${homepage}" &`);
        } else {
          spawn(openCmd, [homepage], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const homepage = context.project.homepage;
        if (!homepage) return [];

        const openCmd = WebEvent.getOpenCommand();
        return [`${openCmd} "${homepage}" &`];
      },
    };
  }

  static get tmux() {
    return null;
  }

  static get help(): EventHelp {
    return {
      usage: 'web: true | false',
      description: 'Open the project homepage in the default browser',
      examples: [
        { config: true, description: 'Enable browser opening' },
        { config: false, description: 'Disable browser opening' },
      ],
    };
  }
}

export default WebEvent;
