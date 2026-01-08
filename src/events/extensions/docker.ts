import { spawn } from 'child_process';
import { input } from '@inquirer/prompts';
import type {
  EventMetadata,
  EventValidation,
  EventConfiguration,
  EventProcessing,
  EventHelp,
  EventProcessingContext,
  DockerConfig,
} from '../../types/index.js';

export class DockerEvent {
  static get metadata(): EventMetadata {
    return {
      name: 'docker',
      displayName: 'Docker container management',
      description: 'Start/stop Docker containers for the project',
      category: 'development',
      requiresTmux: false,
      dependencies: ['docker'],
    };
  }

  static get validation(): EventValidation {
    return {
      validateConfig(config: unknown): true | string {
        if (typeof config === 'boolean' || config === 'true' || config === 'false') {
          return true;
        }

        if (typeof config === 'string') {
          // Assume it's a compose file path
          return true;
        }

        if (typeof config === 'object' && config !== null) {
          const cfg = config as DockerConfig;

          if (cfg.compose_file !== undefined && typeof cfg.compose_file !== 'string') {
            return 'docker.compose_file must be a string';
          }

          if (cfg.services !== undefined) {
            if (!Array.isArray(cfg.services)) {
              return 'docker.services must be an array';
            }
            for (const service of cfg.services) {
              if (typeof service !== 'string') {
                return 'docker.services must contain only strings';
              }
            }
          }

          return true;
        }

        return 'docker config must be a boolean, string (compose file), or object';
      },
    };
  }

  static get configuration(): EventConfiguration {
    return {
      async configureInteractive(): Promise<string | DockerConfig> {
        const composeFile = await input({
          message: 'Enter docker-compose file path:',
          default: 'docker-compose.yml',
        });

        const servicesInput = await input({
          message: 'Enter services to start (comma-separated, leave empty for all):',
          default: '',
        });

        const services = servicesInput
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (composeFile === 'docker-compose.yml' && services.length === 0) {
          return { compose_file: 'docker-compose.yml' };
        }

        if (services.length === 0) {
          return composeFile;
        }

        return {
          compose_file: composeFile,
          services,
        };
      },
      getDefaultConfig(): DockerConfig {
        return { compose_file: 'docker-compose.yml' };
      },
    };
  }

  static getDockerCommand(config: boolean | string | DockerConfig | undefined): string {
    if (typeof config === 'boolean' || config === undefined) {
      return 'docker-compose up -d';
    }

    if (typeof config === 'string') {
      return `docker-compose -f ${config} up -d`;
    }

    const composeFile = config.compose_file || 'docker-compose.yml';
    const services = config.services?.join(' ') || '';

    return `docker-compose -f ${composeFile} up -d ${services}`.trim();
  }

  static get processing(): EventProcessing {
    return {
      async processEvent(context: EventProcessingContext): Promise<void> {
        const { project, isShellMode, shellCommands } = context;
        const dockerConfig = project.events.docker;
        const dockerCommand = DockerEvent.getDockerCommand(
          dockerConfig as boolean | string | DockerConfig
        );

        if (isShellMode) {
          shellCommands.push(dockerCommand);
        } else {
          const [cmd, ...args] = dockerCommand.split(' ');
          spawn(cmd, args, {
            cwd: project.path.path,
            stdio: 'inherit',
          });
        }
      },
      generateShellCommand(context: EventProcessingContext): string[] {
        const dockerConfig = context.project.events.docker;
        return [DockerEvent.getDockerCommand(dockerConfig as boolean | string | DockerConfig)];
      },
    };
  }

  static get tmux() {
    return null;
  }

  static get help(): EventHelp {
    return {
      usage: 'docker: true | "compose-file.yml" | { compose_file: string, services?: string[] }',
      description: 'Start Docker containers for the project',
      examples: [
        { config: true, description: 'Use default docker-compose.yml' },
        { config: 'docker-compose.dev.yml', description: 'Use custom compose file' },
        {
          config: { compose_file: 'docker-compose.yml', services: ['web', 'db'] },
          description: 'Start specific services',
        },
      ],
    };
  }
}

export default DockerEvent;
