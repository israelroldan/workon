import { spawn } from 'child_process';
import { input, confirm } from '@inquirer/prompts';
import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventTmux,
  EventHelp,
  EventProcessingContext,
  NpmConfig,
} from '../../types/index.js';

export class NpmEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'npm',
      displayName: 'Run NPM command',
      description: 'Execute NPM scripts in project directory',
      category: 'development',
      requiresTmux: true,
      dependencies: ['npm'],
    };
  }

  static get validation(): EventValidation {
    return {
      validateConfig(config: unknown): true | string {
        if (typeof config === 'boolean' || config === 'true' || config === 'false') {
          return true;
        }

        if (typeof config === 'string') {
          if (config.trim().length === 0) {
            return 'npm script name cannot be empty';
          }
          return true;
        }

        if (typeof config === 'object' && config !== null) {
          const cfg = config as NpmConfig;

          if (typeof cfg.command !== 'string' || cfg.command.trim().length === 0) {
            return 'npm.command must be a non-empty string';
          }

          if (cfg.watch !== undefined && typeof cfg.watch !== 'boolean') {
            return 'npm.watch must be a boolean';
          }

          if (cfg.auto_restart !== undefined && typeof cfg.auto_restart !== 'boolean') {
            return 'npm.auto_restart must be a boolean';
          }

          return true;
        }

        return 'npm config must be a boolean, string (script name), or object';
      },
    };
  }

  static get configuration(): EventConfiguration {
    return {
      async configureInteractive(): Promise<string | NpmConfig> {
        const scriptName = await input({
          message: 'Enter NPM script to run:',
          default: 'dev',
        });

        const useAdvanced = await confirm({
          message: 'Configure advanced NPM options?',
          default: false,
        });

        if (!useAdvanced) {
          return scriptName;
        }

        const watch = await confirm({
          message: 'Enable watch mode?',
          default: false,
        });

        const autoRestart = await confirm({
          message: 'Auto-restart on crash?',
          default: false,
        });

        if (!watch && !autoRestart) {
          return scriptName;
        }

        return {
          command: scriptName,
          watch,
          auto_restart: autoRestart,
        };
      },
      getDefaultConfig(): string {
        return 'dev';
      },
    };
  }

  static getNpmCommand(config: boolean | string | NpmConfig | undefined): string {
    if (typeof config === 'boolean' || config === undefined) {
      return 'npm run dev';
    }

    if (typeof config === 'string') {
      return `npm run ${config}`;
    }

    return `npm run ${config.command}`;
  }

  static get processing(): EventProcessing {
    return {
      async processEvent(context: EventProcessingContext): Promise<void> {
        const { project, isShellMode, shellCommands } = context;
        const npmConfig = project.events.npm;
        const npmCommand = NpmEvent.getNpmCommand(npmConfig as boolean | string | NpmConfig);

        if (isShellMode) {
          shellCommands.push(npmCommand);
        } else {
          const [cmd, ...args] = npmCommand.split(' ');
          spawn(cmd, args, {
            cwd: project.path.path,
            stdio: 'inherit',
          });
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const npmConfig = context.project.events.npm;
        return [NpmEvent.getNpmCommand(npmConfig as boolean | string | NpmConfig)];
      },
    };
  }

  static get tmux(): EventTmux {
    return {
      getLayoutPriority(): number {
        return 50; // Medium priority
      },
      contributeToLayout(enabledCommands: string[]): string {
        if (enabledCommands.includes('claude')) {
          return 'three-pane';
        }
        return 'two-pane-npm';
      },
    };
  }

  static get help(): EventHelp {
    return {
      usage: 'npm: true | "script" | { command: string, watch?: boolean, auto_restart?: boolean }',
      description: 'Run an NPM script in the project directory',
      examples: [
        { config: true, description: 'Run npm run dev' },
        { config: 'test', description: 'Run npm run test' },
        { config: { command: 'dev', watch: true }, description: 'Run dev with watch mode' },
      ],
    };
  }
}

export default NpmEvent;
