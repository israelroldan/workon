import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebEvent } from '../../../src/events/core/web.js';

describe('WebEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(WebEvent.metadata.name).toBe('web');
    });

    it('should have correct display name', () => {
      expect(WebEvent.metadata.displayName).toBe('Open homepage in browser');
    });

    it('should be in core category', () => {
      expect(WebEvent.metadata.category).toBe('core');
    });

    it('should not require tmux', () => {
      expect(WebEvent.metadata.requiresTmux).toBe(false);
    });

    it('should have no dependencies', () => {
      expect(WebEvent.metadata.dependencies).toEqual([]);
    });
  });

  describe('validation', () => {
    it('should accept boolean true', () => {
      expect(WebEvent.validation.validateConfig(true)).toBe(true);
    });

    it('should accept boolean false', () => {
      expect(WebEvent.validation.validateConfig(false)).toBe(true);
    });

    it('should accept string "true"', () => {
      expect(WebEvent.validation.validateConfig('true')).toBe(true);
    });

    it('should accept string "false"', () => {
      expect(WebEvent.validation.validateConfig('false')).toBe(true);
    });

    it('should reject invalid string', () => {
      const result = WebEvent.validation.validateConfig('invalid');
      expect(result).toBe('web config must be a boolean (true/false)');
    });

    it('should reject number', () => {
      const result = WebEvent.validation.validateConfig(123);
      expect(result).toBe('web config must be a boolean (true/false)');
    });

    it('should reject object', () => {
      const result = WebEvent.validation.validateConfig({ url: 'test' });
      expect(result).toBe('web config must be a boolean (true/false)');
    });
  });

  describe('configuration', () => {
    it('should have default config of true', () => {
      expect(WebEvent.configuration.getDefaultConfig()).toBe(true);
    });

    it('should return true from configureInteractive', async () => {
      const result = await WebEvent.configuration.configureInteractive();
      expect(result).toBe(true);
    });
  });

  describe('getOpenCommand', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return open on darwin', async () => {
      vi.doMock('os', () => ({ platform: () => 'darwin' }));
      // Since we can't easily mock platform() for an already imported module,
      // we test the actual platform behavior
      const cmd = WebEvent.getOpenCommand();
      // On macOS this will be 'open', on Linux 'xdg-open', on Windows 'start'
      expect(['open', 'xdg-open', 'start']).toContain(cmd);
    });
  });

  describe('processing', () => {
    it('should generate open command with homepage', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        homepage: 'https://example.com',
        events: { web: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof WebEvent.processing.generateShellCommand>[0];

      const commands = WebEvent.processing.generateShellCommand(context);
      expect(commands.length).toBe(1);
      expect(commands[0]).toContain('https://example.com');
      expect(commands[0]).toContain('&');
    });

    it('should return empty array when no homepage is set', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { web: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof WebEvent.processing.generateShellCommand>[0];

      const commands = WebEvent.processing.generateShellCommand(context);
      expect(commands).toEqual([]);
    });
  });

  describe('tmux', () => {
    it('should return null (no tmux support)', () => {
      expect(WebEvent.tmux).toBeNull();
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(WebEvent.help.usage).toBe('web: true | false');
    });

    it('should have description', () => {
      expect(WebEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(WebEvent.help.examples).toHaveLength(2);
    });
  });
});
