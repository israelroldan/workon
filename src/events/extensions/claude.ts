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
  ClaudeConfig,
} from '../../types/index.js';

export class ClaudeEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'claude',
      displayName: 'Launch Claude Code',
      description: 'Launch Claude Code with optional flags and configuration',
      category: 'development',
      requiresTmux: true,
      dependencies: ['claude'],
    };
  }

  static get validation(): EventValidation {
    return {
      validateConfig(config: unknown): true | string {
        if (typeof config === 'boolean' || config === 'true' || config === 'false') {
          return true;
        }

        if (typeof config === 'object' && config !== null) {
          const cfg = config as ClaudeConfig;

          if (cfg.flags !== undefined) {
            if (!Array.isArray(cfg.flags)) {
              return 'claude.flags must be an array of strings';
            }
            for (const flag of cfg.flags) {
              if (typeof flag !== 'string') {
                return 'claude.flags must contain only strings';
              }
              if (!flag.startsWith('-')) {
                return `Invalid flag "${flag}": flags must start with - or --`;
              }
            }
          }

          if (cfg.split_terminal !== undefined && typeof cfg.split_terminal !== 'boolean') {
            return 'claude.split_terminal must be a boolean';
          }

          return true;
        }

        return 'claude config must be a boolean or object with flags/split_terminal';
      },
    };
  }

  static get configuration(): EventConfiguration {
    return {
      async configureInteractive(): Promise<boolean | ClaudeConfig> {
        const useAdvanced = await confirm({
          message: 'Configure advanced Claude options?',
          default: false,
        });

        if (!useAdvanced) {
          return true;
        }

        const flagsInput = await input({
          message: 'Enter Claude flags (comma-separated, e.g., --resume, --debug):',
          default: '',
        });

        const flags = flagsInput
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0 && f.startsWith('-'));

        const splitTerminal = await confirm({
          message: 'Use split terminal layout (Claude + shell)?',
          default: true,
        });

        if (flags.length === 0 && !splitTerminal) {
          return true;
        }

        const config: ClaudeConfig = {};
        if (flags.length > 0) config.flags = flags;
        if (splitTerminal) config.split_terminal = splitTerminal;

        return config;
      },
      getDefaultConfig(): boolean {
        return true;
      },
    };
  }

  static getClaudeCommand(config: boolean | ClaudeConfig | undefined): string {
    if (typeof config === 'boolean' || config === undefined) {
      return 'claude --dangerously-skip-permissions';
    }

    const flags = config.flags || [];
    return flags.length > 0
      ? `claude --dangerously-skip-permissions ${flags.join(' ')}`
      : 'claude --dangerously-skip-permissions';
  }

  static get processing(): EventProcessing {
    return {
      async processEvent(context: EventProcessingContext): Promise<void> {
        const { project, isShellMode, shellCommands } = context;
        const claudeConfig = project.events.claude;
        const claudeCommand = ClaudeEvent.getClaudeCommand(claudeConfig as boolean | ClaudeConfig);

        if (isShellMode) {
          shellCommands.push(claudeCommand);
        } else {
          const args = claudeCommand.split(' ').slice(1);
          spawn('claude', args, {
            cwd: project.path.path,
            stdio: 'inherit',
          });
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const claudeConfig = context.project.events.claude;
        return [ClaudeEvent.getClaudeCommand(claudeConfig as boolean | ClaudeConfig)];
      },
    };
  }

  static get tmux(): EventTmux {
    return {
      getLayoutPriority(): number {
        return 100; // High priority for Claude
      },
      contributeToLayout(enabledCommands: string[]): string {
        if (enabledCommands.includes('npm')) {
          return 'three-pane';
        }
        return 'split';
      },
    };
  }

  static get help(): EventHelp {
    return {
      usage: 'claude: true | { flags: string[], split_terminal: boolean }',
      description: 'Launch Claude Code in the project directory',
      examples: [
        { config: true, description: 'Launch Claude with defaults' },
        { config: { flags: ['--resume'] }, description: 'Resume previous session' },
        {
          config: { flags: ['--model', 'opus'], split_terminal: true },
          description: 'Use Opus model with split terminal',
        },
      ],
    };
  }
}

export default ClaudeEvent;
