import { describe, it, expect } from 'vitest';
import { ClaudeEvent } from '../../../src/events/extensions/claude.js';

describe('ClaudeEvent', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(ClaudeEvent.metadata.name).toBe('claude');
    });

    it('should have correct display name', () => {
      expect(ClaudeEvent.metadata.displayName).toBe('Launch Claude Code');
    });

    it('should be in development category', () => {
      expect(ClaudeEvent.metadata.category).toBe('development');
    });

    it('should require tmux', () => {
      expect(ClaudeEvent.metadata.requiresTmux).toBe(true);
    });

    it('should depend on claude', () => {
      expect(ClaudeEvent.metadata.dependencies).toContain('claude');
    });
  });

  describe('validation', () => {
    describe('boolean configs', () => {
      it('should accept boolean true', () => {
        expect(ClaudeEvent.validation.validateConfig(true)).toBe(true);
      });

      it('should accept boolean false', () => {
        expect(ClaudeEvent.validation.validateConfig(false)).toBe(true);
      });

      it('should accept string "true"', () => {
        expect(ClaudeEvent.validation.validateConfig('true')).toBe(true);
      });

      it('should accept string "false"', () => {
        expect(ClaudeEvent.validation.validateConfig('false')).toBe(true);
      });
    });

    describe('object configs', () => {
      it('should accept empty object', () => {
        expect(ClaudeEvent.validation.validateConfig({})).toBe(true);
      });

      it('should accept object with valid flags', () => {
        // Flags must all start with - or --
        expect(ClaudeEvent.validation.validateConfig({ flags: ['--model', '--debug'] })).toBe(true);
        expect(ClaudeEvent.validation.validateConfig({ flags: ['-v', '--resume'] })).toBe(true);
      });

      it('should accept object with split_terminal', () => {
        expect(ClaudeEvent.validation.validateConfig({ split_terminal: true })).toBe(true);
      });

      it('should accept object with both flags and split_terminal', () => {
        const config = { flags: ['--resume'], split_terminal: true };
        expect(ClaudeEvent.validation.validateConfig(config)).toBe(true);
      });
    });

    describe('invalid flags', () => {
      it('should reject non-array flags', () => {
        const result = ClaudeEvent.validation.validateConfig({ flags: '--model' });
        expect(result).toBe('claude.flags must be an array of strings');
      });

      it('should reject non-string flag items', () => {
        const result = ClaudeEvent.validation.validateConfig({ flags: [123] });
        expect(result).toBe('claude.flags must contain only strings');
      });

      it('should reject flags not starting with -', () => {
        const result = ClaudeEvent.validation.validateConfig({ flags: ['model'] });
        expect(result).toBe('Invalid flag "model": flags must start with - or --');
      });
    });

    describe('invalid split_terminal', () => {
      it('should reject non-boolean split_terminal', () => {
        const result = ClaudeEvent.validation.validateConfig({ split_terminal: 'yes' });
        expect(result).toBe('claude.split_terminal must be a boolean');
      });
    });

    describe('invalid types', () => {
      it('should reject number', () => {
        const result = ClaudeEvent.validation.validateConfig(123);
        expect(result).toBe('claude config must be a boolean or object with flags/split_terminal');
      });

      it('should reject invalid string', () => {
        const result = ClaudeEvent.validation.validateConfig('invalid');
        expect(result).toBe('claude config must be a boolean or object with flags/split_terminal');
      });
    });
  });

  describe('getClaudeCommand', () => {
    it('should return basic claude command for boolean true', () => {
      expect(ClaudeEvent.getClaudeCommand(true)).toBe('claude');
    });

    it('should return basic claude command for boolean false', () => {
      expect(ClaudeEvent.getClaudeCommand(false)).toBe('claude');
    });

    it('should return basic claude command for undefined', () => {
      expect(ClaudeEvent.getClaudeCommand(undefined)).toBe('claude');
    });

    it('should return claude with flags', () => {
      expect(ClaudeEvent.getClaudeCommand({ flags: ['--resume', '--debug'] })).toBe(
        'claude --resume --debug'
      );
    });

    it('should return basic claude for object without flags', () => {
      expect(ClaudeEvent.getClaudeCommand({ split_terminal: true })).toBe('claude');
    });

    it('should return basic claude for object with empty flags', () => {
      expect(ClaudeEvent.getClaudeCommand({ flags: [] })).toBe('claude');
    });
  });

  describe('configuration', () => {
    it('should have default config of true', () => {
      expect(ClaudeEvent.configuration.getDefaultConfig()).toBe(true);
    });
  });

  describe('processing', () => {
    it('should generate basic claude command', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { claude: true },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof ClaudeEvent.processing.generateShellCommand>[0];

      const commands = ClaudeEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['claude']);
    });

    it('should generate claude command with flags', () => {
      const mockProject = {
        path: { path: '/path/to/project' },
        events: { claude: { flags: ['--resume', '--debug'] } },
      };

      const context = {
        project: mockProject,
        isShellMode: true,
        shellCommands: [],
      } as unknown as Parameters<typeof ClaudeEvent.processing.generateShellCommand>[0];

      const commands = ClaudeEvent.processing.generateShellCommand(context);
      expect(commands).toEqual(['claude --resume --debug']);
    });
  });

  describe('tmux', () => {
    it('should have layout priority of 100', () => {
      expect(ClaudeEvent.tmux!.getLayoutPriority()).toBe(100);
    });

    it('should contribute three-pane layout when npm is enabled', () => {
      expect(ClaudeEvent.tmux!.contributeToLayout!(['npm'])).toBe('three-pane');
    });

    it('should contribute split layout when npm is not enabled', () => {
      expect(ClaudeEvent.tmux!.contributeToLayout!([])).toBe('split');
      expect(ClaudeEvent.tmux!.contributeToLayout!(['cwd', 'ide'])).toBe('split');
    });
  });

  describe('help', () => {
    it('should have usage information', () => {
      expect(ClaudeEvent.help.usage).toContain('claude:');
    });

    it('should have description', () => {
      expect(ClaudeEvent.help.description).toBeDefined();
    });

    it('should have examples', () => {
      expect(ClaudeEvent.help.examples.length).toBeGreaterThan(0);
    });

    it('should include resume example', () => {
      const resumeExample = ClaudeEvent.help.examples.find((ex) => {
        if (typeof ex.config === 'object' && ex.config !== null) {
          const config = ex.config as { flags?: string[] };
          return config.flags?.includes('--resume');
        }
        return false;
      });
      expect(resumeExample).toBeDefined();
    });
  });
});
