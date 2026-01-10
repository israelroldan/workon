import { describe, it, expect } from 'vitest';
import { BaseEvent } from '../../src/events/base.js';

// Create a concrete implementation for testing
class TestEvent extends BaseEvent {
  static get metadata() {
    return {
      name: 'test',
      displayName: 'Test Event',
      description: 'A test event for testing',
      category: 'test' as const,
      requiresTmux: false,
      dependencies: [],
    };
  }
}

describe('BaseEvent', () => {
  describe('static metadata', () => {
    it('should throw error when accessing metadata on BaseEvent directly', () => {
      expect(() => BaseEvent.metadata).toThrow('Event must implement static metadata getter');
    });

    it('should return metadata when implemented in subclass', () => {
      expect(TestEvent.metadata.name).toBe('test');
      expect(TestEvent.metadata.displayName).toBe('Test Event');
    });
  });

  describe('instance metadata', () => {
    it('should return static metadata through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      expect(event.metadata.name).toBe('test');
    });
  });

  describe('static validation', () => {
    it('should accept any config by default', () => {
      expect(BaseEvent.validation.validateConfig(true)).toBe(true);
      expect(BaseEvent.validation.validateConfig('anything')).toBe(true);
      expect(BaseEvent.validation.validateConfig({ any: 'object' })).toBe(true);
      expect(BaseEvent.validation.validateConfig(null)).toBe(true);
    });
  });

  describe('instance validation', () => {
    it('should return static validation through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      expect(event.validation.validateConfig('test')).toBe(true);
    });
  });

  describe('static configuration', () => {
    it('should return true as default config', () => {
      expect(BaseEvent.configuration.getDefaultConfig()).toBe(true);
    });

    it('should return true from configureInteractive', async () => {
      const result = await BaseEvent.configuration.configureInteractive();
      expect(result).toBe(true);
    });
  });

  describe('instance configuration', () => {
    it('should return static configuration through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      expect(event.configuration.getDefaultConfig()).toBe(true);
    });
  });

  describe('static processing', () => {
    it('should throw error from processEvent by default', async () => {
      const context = {} as Parameters<typeof BaseEvent.processing.processEvent>[0];
      await expect(BaseEvent.processing.processEvent(context)).rejects.toThrow(
        'Event must implement processEvent method'
      );
    });

    it('should return empty array from generateShellCommand by default', () => {
      const context = {} as Parameters<typeof BaseEvent.processing.generateShellCommand>[0];
      expect(BaseEvent.processing.generateShellCommand(context)).toEqual([]);
    });
  });

  describe('instance processing', () => {
    it('should return static processing through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      const context = {} as Parameters<typeof BaseEvent.processing.generateShellCommand>[0];
      expect(event.processing.generateShellCommand(context)).toEqual([]);
    });
  });

  describe('static tmux', () => {
    it('should return null by default', () => {
      expect(BaseEvent.tmux).toBeNull();
    });
  });

  describe('instance tmux', () => {
    it('should return static tmux through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      expect(event.tmux).toBeNull();
    });
  });

  describe('static help', () => {
    it('should generate help from metadata', () => {
      const help = TestEvent.help;
      expect(help.usage).toContain('test');
      expect(help.description).toBe('A test event for testing');
      expect(help.examples).toEqual([]);
    });
  });

  describe('instance help', () => {
    it('should return static help through instance', () => {
      const event = new (TestEvent as unknown as new () => TestEvent)();
      expect(event.help.description).toBe('A test event for testing');
    });
  });
});
