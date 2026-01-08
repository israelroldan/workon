import { spawn } from 'child_process';
import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventHelp,
  EventProcessingContext,
} from '../../types/index.js';

export class IdeEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'ide',
      displayName: 'Open in IDE',
      description: 'Open project in configured IDE/editor',
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
        return 'ide config must be a boolean (true/false)';
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

  static get processing(): EventProcessing {
    return {
      async processEvent(context: EventProcessingContext): Promise<void> {
        const { project, isShellMode, shellCommands } = context;
        const projectPath = project.path.path;
        const ide = project.ide || 'code';

        if (isShellMode) {
          shellCommands.push(`${ide} "${projectPath}" &`);
        } else {
          spawn(ide, [projectPath], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const projectPath = context.project.path.path;
        const ide = context.project.ide || 'code';
        return [`${ide} "${projectPath}" &`];
      },
    };
  }

  static get tmux() {
    return null;
  }

  static get help(): EventHelp {
    return {
      usage: 'ide: true | false',
      description: 'Open the project in the configured IDE',
      examples: [
        { config: true, description: 'Enable IDE opening' },
        { config: false, description: 'Disable IDE opening' },
      ],
    };
  }
}

export default IdeEvent;
