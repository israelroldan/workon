import { describe, it, expect } from 'vitest';
import { DockerEvent } from '../../../src/events/extensions/docker.js';

describe('DockerEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(DockerEvent.metadata.name).toBe('docker');
    });

    it('should have correct display name', () => {
      expect(DockerEvent.metadata.displayName).toBe('Docker container management');
    });

    it('should be in development category', () => {
      expect(DockerEvent.metadata.category).toBe('development');
    });

    it('should not require tmux', () => {
      expect(DockerEvent.metadata.requiresTmux).toBe(false);
    });

    it('should depend on docker', () => {
      expect(DockerEvent.metadata.dependencies).toContain('docker');
    });
  });

  describe('validation', () => {
    describe('boolean configs', () => {
      it('should accept boolean true', () => {
        expect(DockerEvent.validation.validateConfig(true)).toBe(true);
      });

      it('should accept boolean false', () => {
        expect(DockerEvent.validation.validateConfig(false)).toBe(true);
      });

      it('should accept string "true"', () => {
        expect(DockerEvent.validation.validateConfig('true')).toBe(true);
      });

      it('should accept string "false"', () => {
        expect(DockerEvent.validation.validateConfig('false')).toBe(true);
      });
    });

    describe('string configs', () => {
      it('should accept compose file path string', () => {
        expect(DockerEvent.validation.validateConfig('docker-compose.dev.yml')).toBe(true);
      });
    });

    describe('object configs', () => {
      it('should accept empty object', () => {
        expect(DockerEvent.validation.validateConfig({})).toBe(true);
      });

      it('should accept object with compose_file', () => {
        expect(DockerEvent.validation.validateConfig({ compose_file: 'docker-compose.yml' })).toBe(
          true
        );
      });

      it('should accept object with services array', () => {
        expect(DockerEvent.validation.validateConfig({ services: ['web', 'db'] })).toBe(true);
      });

      it('should accept object with both compose_file and services', () => {
        const config = { compose_file: 'docker-compose.yml', services: ['web'] };
        expect(DockerEvent.validation.validateConfig(config)).toBe(true);
      });
    });

    describe('invalid configs', () => {
      it('should reject non-string compose_file', () => {
        const result = DockerEvent.validation.validateConfig({ compose_file: 123 });
        expect(result).toBe('docker.compose_file must be a string');
      });

      it('should reject non-array services', () => {
        const result = DockerEvent.validation.validateConfig({ services: 'web' });
        expect(result).toBe('docker.services must be an array');
      });

      it('should reject non-string service items', () => {
        const result = DockerEvent.validation.validateConfig({ services: [123] });
        expect(result).toBe('docker.services must contain only strings');
      });

      it('should reject number', () => {
        const result = DockerEvent.validation.validateConfig(123);
        expect(result).toBe('docker config must be a boolean, string (compose file), or object');
      });
    });
  });

  describe('getDockerCommand', () => {
    it('should return default command for boolean true', () => {
      expect(DockerEvent.getDockerCommand(true)).toBe('docker-compose up -d');
    });

    it('should return default command for undefined', () => {
      expect(DockerEvent.getDockerCommand(undefined)).toBe('docker-compose up -d');
    });

    it('should use compose file from string config', () => {
      expect(DockerEvent.getDockerCommand('docker-compose.dev.yml')).toBe(
        'docker-compose -f docker-compose.dev.yml up -d'
      );
    });

    it('should use compose file from object config', () => {
      expect(DockerEvent.getDockerCommand({ compose_file: 'custom.yml' })).toBe(
        'docker-compose -f custom.yml up -d'
      );
    });

    it('should include services when specified', () => {
      const config = { compose_file: 'docker-compose.yml', services: ['web', 'db'] };
      expect(DockerEvent.getDockerCommand(config)).toBe(
        'docker-compose -f docker-compose.yml up -d web db'
      );
    });

    it('should use default compose file when not specified', () => {
      expect(DockerEvent.getDockerCommand({ compose_file: 'docker-compose.yml', services: ['web'] })).toBe(
        'docker-compose -f docker-compose.yml up -d web'
      );
    });
  });

  describe('configuration', () => {
    it('should have default config with compose_file', () => {
      expect(DockerEvent.configuration.getDefaultConfig()).toEqual({
        compose_file: 'docker-compose.yml',
      });
    });
  });

  describe('processing', () => {
    it('should generate docker-compose command', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { docker: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof DockerEvent.processing.generateShellCommand>[0];

      const commands = DockerEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['docker-compose up -d']);
    });

    it('should generate docker-compose command with custom config', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { docker: { compose_file: 'dev.yml', services: ['api'] } },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof DockerEvent.processing.generateShellCommand>[0];

      const commands = DockerEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['docker-compose -f dev.yml up -d api']);
    });
  });

  describe('tmux', () => {
    it('should return null (no tmux support)', () => {
      expect(DockerEvent.tmux).toBeNull();
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(DockerEvent.help.usage).toContain('docker:');
    });

    it('should have description', () => {
      expect(DockerEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(DockerEvent.help.examples.length).toBeGreaterThan(0);
    });
  });
});
