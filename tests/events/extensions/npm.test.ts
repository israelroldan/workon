import { describe, it, expect } from 'vitest';
import { NpmEvent } from '../../../src/events/extensions/npm.js';

describe('NpmEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(NpmEvent.metadata.name).toBe('npm');
    });

    it('should have correct display name', () => {
      expect(NpmEvent.metadata.displayName).toBe('Run NPM command');
    });

    it('should be in development category', () => {
      expect(NpmEvent.metadata.category).toBe('development');
    });

    it('should require tmux', () => {
      expect(NpmEvent.metadata.requiresTmux).toBe(true);
    });

    it('should depend on npm', () => {
      expect(NpmEvent.metadata.dependencies).toContain('npm');
    });
  });

  describe('validation', () => {
    describe('boolean configs', () => {
      it('should accept boolean true', () => {
        expect(NpmEvent.validation.validateConfig(true)).toBe(true);
      });

      it('should accept boolean false', () => {
        expect(NpmEvent.validation.validateConfig(false)).toBe(true);
      });

      it('should accept string "true"', () => {
        expect(NpmEvent.validation.validateConfig('true')).toBe(true);
      });

      it('should accept string "false"', () => {
        expect(NpmEvent.validation.validateConfig('false')).toBe(true);
      });
    });

    describe('string configs', () => {
      it('should accept script name string', () => {
        expect(NpmEvent.validation.validateConfig('dev')).toBe(true);
        expect(NpmEvent.validation.validateConfig('build')).toBe(true);
        expect(NpmEvent.validation.validateConfig('test:unit')).toBe(true);
      });

      it('should reject empty string', () => {
        const result = NpmEvent.validation.validateConfig('');
        expect(result).toBe('npm script name cannot be empty');
      });

      it('should reject whitespace-only string', () => {
        const result = NpmEvent.validation.validateConfig('   ');
        expect(result).toBe('npm script name cannot be empty');
      });
    });

    describe('object configs', () => {
      it('should accept object with command', () => {
        expect(NpmEvent.validation.validateConfig({ command: 'dev' })).toBe(true);
      });

      it('should accept object with command and watch', () => {
        expect(NpmEvent.validation.validateConfig({ command: 'dev', watch: true })).toBe(true);
      });

      it('should accept object with command and auto_restart', () => {
        expect(NpmEvent.validation.validateConfig({ command: 'dev', auto_restart: true })).toBe(
          true
        );
      });

      it('should accept object with all options', () => {
        const config = { command: 'dev', watch: true, auto_restart: false };
        expect(NpmEvent.validation.validateConfig(config)).toBe(true);
      });
    });

    describe('invalid object configs', () => {
      it('should reject object without command', () => {
        const result = NpmEvent.validation.validateConfig({});
        expect(result).toBe('npm.command must be a non-empty string');
      });

      it('should reject object with empty command', () => {
        const result = NpmEvent.validation.validateConfig({ command: '' });
        expect(result).toBe('npm.command must be a non-empty string');
      });

      it('should reject object with non-string command', () => {
        const result = NpmEvent.validation.validateConfig({ command: 123 });
        expect(result).toBe('npm.command must be a non-empty string');
      });

      it('should reject object with non-boolean watch', () => {
        const result = NpmEvent.validation.validateConfig({ command: 'dev', watch: 'yes' });
        expect(result).toBe('npm.watch must be a boolean');
      });

      it('should reject object with non-boolean auto_restart', () => {
        const result = NpmEvent.validation.validateConfig({ command: 'dev', auto_restart: 'yes' });
        expect(result).toBe('npm.auto_restart must be a boolean');
      });
    });

    describe('invalid types', () => {
      it('should reject number', () => {
        const result = NpmEvent.validation.validateConfig(123);
        expect(result).toBe('npm config must be a boolean, string (script name), or object');
      });

      it('should reject array (treated as object without command)', () => {
        // Arrays are objects in JS, so they fall through to object validation
        const result = NpmEvent.validation.validateConfig(['dev', 'build']);
        expect(result).toBe('npm.command must be a non-empty string');
      });
    });
  });

  describe('getNpmCommand', () => {
    it('should return npm run dev for boolean true', () => {
      expect(NpmEvent.getNpmCommand(true)).toBe('npm run dev');
    });

    it('should return npm run dev for undefined', () => {
      expect(NpmEvent.getNpmCommand(undefined)).toBe('npm run dev');
    });

    it('should use script name from string config', () => {
      expect(NpmEvent.getNpmCommand('build')).toBe('npm run build');
      expect(NpmEvent.getNpmCommand('test')).toBe('npm run test');
    });

    it('should use command from object config', () => {
      expect(NpmEvent.getNpmCommand({ command: 'start' })).toBe('npm run start');
    });

    it('should use command from object with other options', () => {
      expect(NpmEvent.getNpmCommand({ command: 'dev', watch: true })).toBe('npm run dev');
    });
  });

  describe('configuration', () => {
    it('should have default config of dev', () => {
      expect(NpmEvent.configuration.getDefaultConfig()).toBe('dev');
    });
  });

  describe('processing', () => {
    it('should generate npm run command', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { npm: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof NpmEvent.processing.generateShellCommand>[0];

      const commands = NpmEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['npm run dev']);
    });

    it('should generate npm run command with custom script', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { npm: 'build' },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof NpmEvent.processing.generateShellCommand>[0];

      const commands = NpmEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['npm run build']);
    });
  });

  describe('tmux', () => {
    it('should have layout priority of 50', () => {
      expect(NpmEvent.tmux.getLayoutPriority()).toBe(50);
    });

    it('should contribute three-pane layout when claude is enabled', () => {
      expect(NpmEvent.tmux.contributeToLayout(['claude'])).toBe('three-pane');
    });

    it('should contribute two-pane-npm layout when claude is not enabled', () => {
      expect(NpmEvent.tmux.contributeToLayout([])).toBe('two-pane-npm');
      expect(NpmEvent.tmux.contributeToLayout(['cwd', 'ide'])).toBe('two-pane-npm');
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(NpmEvent.help.usage).toContain('npm:');
    });

    it('should have description', () => {
      expect(NpmEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(NpmEvent.help.examples.length).toBeGreaterThan(0);
    });

    it('should include script example', () => {
      const scriptExample = NpmEvent.help.examples.find((ex) => ex.config === 'test');
      expect(scriptExample).toBeDefined();
    });
  });
});
