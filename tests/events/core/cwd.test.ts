import { describe, it, expect } from 'vitest';
import { CwdEvent } from '../../../src/events/core/cwd.js';

describe('CwdEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(CwdEvent.metadata.name).toBe('cwd');
    });

    it('should have correct display name', () => {
      expect(CwdEvent.metadata.displayName).toBe('Change directory (cwd)');
    });

    it('should be in core category', () => {
      expect(CwdEvent.metadata.category).toBe('core');
    });

    it('should not require tmux', () => {
      expect(CwdEvent.metadata.requiresTmux).toBe(false);
    });

    it('should have no dependencies', () => {
      expect(CwdEvent.metadata.dependencies).toEqual([]);
    });
  });

  describe('validation', () => {
    it('should accept boolean true', () => {
      expect(CwdEvent.validation.validateConfig(true)).toBe(true);
    });

    it('should accept boolean false', () => {
      expect(CwdEvent.validation.validateConfig(false)).toBe(true);
    });

    it('should accept string "true"', () => {
      expect(CwdEvent.validation.validateConfig('true')).toBe(true);
    });

    it('should accept string "false"', () => {
      expect(CwdEvent.validation.validateConfig('false')).toBe(true);
    });

    it('should reject invalid string', () => {
      const result = CwdEvent.validation.validateConfig('invalid');
      expect(result).toBe('cwd config must be a boolean (true/false)');
    });

    it('should reject number', () => {
      const result = CwdEvent.validation.validateConfig(123);
      expect(result).toBe('cwd config must be a boolean (true/false)');
    });

    it('should reject object', () => {
      const result = CwdEvent.validation.validateConfig({ enabled: true });
      expect(result).toBe('cwd config must be a boolean (true/false)');
    });

    it('should reject null', () => {
      const result = CwdEvent.validation.validateConfig(null);
      expect(result).toBe('cwd config must be a boolean (true/false)');
    });
  });

  describe('configuration', () => {
    it('should have default config of true', () => {
      expect(CwdEvent.configuration.getDefaultConfig()).toBe(true);
    });

    it('should return true from configureInteractive', async () => {
      const result = await CwdEvent.configuration.configureInteractive();
      expect(result).toBe(true);
    });
  });

  describe('processing', () => {
    it('should generate pushd shell command', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { cwd: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof CwdEvent.processing.generateShellCommand>[0];

      const commands = CwdEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['pushd "/path/to/project" > /dev/null']);
    });

    it('should handle paths with spaces', () => {
      const mockProject = {
        path: { path: '/path/with spaces/project' },
        events: { cwd: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof CwdEvent.processing.generateShellCommand>[0];

      const commands = CwdEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['pushd "/path/with spaces/project" > /dev/null']);
    });
  });

  describe('tmux', () => {
    it('should return null (no tmux support)', () => {
      expect(CwdEvent.tmux).toBeNull();
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(CwdEvent.help.usage).toBe('cwd: true | false');
    });

    it('should have description', () => {
      expect(CwdEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(CwdEvent.help.examples).toHaveLength(2);
      expect(CwdEvent.help.examples[0].config).toBe(true);
      expect(CwdEvent.help.examples[1].config).toBe(false);
    });
  });
});
