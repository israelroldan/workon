import { spawn } from 'child_process';
import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventHelp,
  EventProcessingContext,
} from '../../types/index.js';

export class CwdEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'cwd',
      displayName: 'Change directory (cwd)',
      description: 'Change current working directory to project path',
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
        return 'cwd config must be a boolean (true/false)';
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

        if (isShellMode) {
          // Use pushd so user can popd to go back
          shellCommands.push(`pushd "${projectPath}" > /dev/null`);
        } else {
          // Spawn a new interactive shell in the project directory and wait for it
          const shell = process.env.SHELL || '/bin/bash';
          const child = spawn(shell, ['-i'], {
            cwd: projectPath,
            stdio: 'inherit',
          });

          // Wait for the shell to exit
          await new Promise<void>((resolve, reject) => {
            child.on('close', () => resolve());
            child.on('error', (err) => reject(err));
          });
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const projectPath = context.project.path.path;
        return [`pushd "${projectPath}" > /dev/null`];
      },
    };
  }

  static get tmux() {
    return null;
  }

  static get help(): EventHelp {
    return {
      usage: 'cwd: true | false',
      description: 'Change the current working directory to the project path',
      examples: [
        { config: true, description: 'Enable directory change' },
        { config: false, description: 'Disable directory change' },
      ],
    };
  }
}

export default CwdEvent;
