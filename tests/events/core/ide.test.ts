import { describe, it, expect } from 'vitest';
import { IdeEvent } from '../../../src/events/core/ide.js';

describe('IdeEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(IdeEvent.metadata.name).toBe('ide');
    });

    it('should have correct display name', () => {
      expect(IdeEvent.metadata.displayName).toBe('Open in IDE');
    });

    it('should be in core category', () => {
      expect(IdeEvent.metadata.category).toBe('core');
    });

    it('should not require tmux', () => {
      expect(IdeEvent.metadata.requiresTmux).toBe(false);
    });

    it('should have no dependencies', () => {
      expect(IdeEvent.metadata.dependencies).toEqual([]);
    });
  });

  describe('validation', () => {
    it('should accept boolean true', () => {
      expect(IdeEvent.validation.validateConfig(true)).toBe(true);
    });

    it('should accept boolean false', () => {
      expect(IdeEvent.validation.validateConfig(false)).toBe(true);
    });

    it('should accept string "true"', () => {
      expect(IdeEvent.validation.validateConfig('true')).toBe(true);
    });

    it('should accept string "false"', () => {
      expect(IdeEvent.validation.validateConfig('false')).toBe(true);
    });

    it('should reject invalid string', () => {
      const result = IdeEvent.validation.validateConfig('invalid');
      expect(result).toBe('ide config must be a boolean (true/false)');
    });

    it('should reject number', () => {
      const result = IdeEvent.validation.validateConfig(123);
      expect(result).toBe('ide config must be a boolean (true/false)');
    });

    it('should reject object', () => {
      const result = IdeEvent.validation.validateConfig({ enabled: true });
      expect(result).toBe('ide config must be a boolean (true/false)');
    });
  });

  describe('configuration', () => {
    it('should have default config of true', () => {
      expect(IdeEvent.configuration.getDefaultConfig()).toBe(true);
    });

    it('should return true from configureInteractive', async () => {
      const result = await IdeEvent.configuration.configureInteractive();
      expect(result).toBe(true);
    });
  });

  describe('processing', () => {
    it('should generate ide command with default code editor', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { ide: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof IdeEvent.processing.generateShellCommand>[0];

      const commands = IdeEvent.processing.generateShellCommand(context);
      // Disable job monitoring to suppress job control output for tmux -CC compatibility
      expect(commands).toEqual(['set +m; code "/path/to/project" &>/dev/null &']);
    });

    it('should use configured ide', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        ide: 'idea',
        events: { ide: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof IdeEvent.processing.generateShellCommand>[0];

      const commands = IdeEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['set +m; idea "/path/to/project" &>/dev/null &']);
    });

    it('should handle paths with spaces', () => {
      const mockProject = {
        path: { path: '/path/with spaces/project' },
        events: { ide: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof IdeEvent.processing.generateShellCommand>[0];

      const commands = IdeEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['set +m; code "/path/with spaces/project" &>/dev/null &']);
    });
  });

  describe('tmux', () => {
    it('should return null (no tmux support)', () => {
      expect(IdeEvent.tmux).toBeNull();
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(IdeEvent.help.usage).toBe('ide: true | false');
    });

    it('should have description', () => {
      expect(IdeEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(IdeEvent.help.examples).toHaveLength(2);
    });
  });
});
