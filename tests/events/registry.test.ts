import { describe, it, expect, beforeEach } from 'vitest';
import { EventRegistry } from '../../src/events/registry.js';

describe('EventRegistry', () => {
  beforeEach(() => {
    // Clear the registry before each test
    EventRegistry.clear();
  });

  describe('initialization', () => {
    it('should throw error if used before initialization', () => {
      expect(() => EventRegistry.getValidEventNames()).toThrow(
        'EventRegistry must be initialized before use'
      );
    });

    it('should initialize successfully', async () => {
      await EventRegistry.initialize();
      expect(EventRegistry.getValidEventNames()).toBeDefined();
    });

    it('should be idempotent - multiple initializations are safe', async () => {
      await EventRegistry.initialize();
      await EventRegistry.initialize();
      expect(EventRegistry.getValidEventNames()).toBeDefined();
    });
  });

  describe('getValidEventNames', () => {
    it('should return all registered event names', async () => {
      await EventRegistry.initialize();
      const names = EventRegistry.getValidEventNames();

      expect(names).toContain('cwd');
      expect(names).toContain('ide');
      expect(names).toContain('web');
      expect(names).toContain('claude');
      expect(names).toContain('docker');
      expect(names).toContain('npm');
    });

    it('should return exactly 6 events', async () => {
      await EventRegistry.initialize();
      const names = EventRegistry.getValidEventNames();
      expect(names).toHaveLength(6);
    });
  });

  describe('getEventByName', () => {
    it('should return event by name', async () => {
      await EventRegistry.initialize();
      const event = EventRegistry.getEventByName('cwd');

      expect(event).toBeDefined();
      expect(event).toHaveProperty('metadata');
      expect(event).toHaveProperty('validation');
      expect(event).toHaveProperty('processing');
    });

    it('should return null for unknown event', async () => {
      await EventRegistry.initialize();
      const event = EventRegistry.getEventByName('nonexistent');
      expect(event).toBeNull();
    });
  });

  describe('getEventsForManageUI', () => {
    it('should return events formatted for UI', async () => {
      await EventRegistry.initialize();
      const events = EventRegistry.getEventsForManageUI();

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('value');
        expect(event).toHaveProperty('description');
      }
    });

    it('should sort events by display name', async () => {
      await EventRegistry.initialize();
      const events = EventRegistry.getEventsForManageUI();
      const names = events.map((e) => e.name);

      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });
  });

  describe('getTmuxEnabledEvents', () => {
    it('should return events with tmux support', async () => {
      await EventRegistry.initialize();
      const tmuxEvents = EventRegistry.getTmuxEnabledEvents();

      // Only claude and npm have tmux support in the current implementation
      expect(tmuxEvents.length).toBeGreaterThan(0);
      for (const evt of tmuxEvents) {
        expect(evt).toHaveProperty('name');
        expect(evt).toHaveProperty('event');
        expect(evt).toHaveProperty('priority');
      }
    });

    it('should sort events by priority (descending)', async () => {
      await EventRegistry.initialize();
      const tmuxEvents = EventRegistry.getTmuxEnabledEvents();

      for (let i = 1; i < tmuxEvents.length; i++) {
        expect(tmuxEvents[i - 1].priority).toBeGreaterThanOrEqual(tmuxEvents[i].priority);
      }
    });

    it('should include claude event with high priority', async () => {
      await EventRegistry.initialize();
      const tmuxEvents = EventRegistry.getTmuxEnabledEvents();

      const claudeEvent = tmuxEvents.find((e) => e.name === 'claude');
      expect(claudeEvent).toBeDefined();
      expect(claudeEvent?.priority).toBe(100);
    });
  });

  describe('getAllEvents', () => {
    it('should return all events with full metadata', async () => {
      await EventRegistry.initialize();
      const events = EventRegistry.getAllEvents();

      expect(events.length).toBe(6);
      for (const event of events) {
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('metadata');
        expect(event).toHaveProperty('hasValidation');
        expect(event).toHaveProperty('hasConfiguration');
        expect(event).toHaveProperty('hasProcessing');
        expect(event).toHaveProperty('hasTmux');
        expect(event).toHaveProperty('hasHelp');
      }
    });

    it('should correctly identify events with tmux support', async () => {
      await EventRegistry.initialize();
      const events = EventRegistry.getAllEvents();

      const cwdEvent = events.find((e) => e.name === 'cwd');
      const claudeEvent = events.find((e) => e.name === 'claude');

      expect(cwdEvent?.hasTmux).toBe(false);
      expect(claudeEvent?.hasTmux).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all registered events', async () => {
      await EventRegistry.initialize();
      expect(EventRegistry.getValidEventNames().length).toBeGreaterThan(0);

      EventRegistry.clear();

      expect(() => EventRegistry.getValidEventNames()).toThrow(
        'EventRegistry must be initialized before use'
      );
    });
  });

  describe('event metadata', () => {
    it('should have correct metadata for core events', async () => {
      await EventRegistry.initialize();

      const cwdEvent = EventRegistry.getEventByName('cwd');
      const cwdMeta = (cwdEvent as { metadata: { category: string; requiresTmux: boolean } })
        .metadata;
      expect(cwdMeta.category).toBe('core');
      expect(cwdMeta.requiresTmux).toBe(false);
    });

    it('should have correct metadata for extension events', async () => {
      await EventRegistry.initialize();

      const claudeEvent = EventRegistry.getEventByName('claude');
      const claudeMeta = (
        claudeEvent as { metadata: { category: string; requiresTmux: boolean; dependencies: string[] } }
      ).metadata;
      expect(claudeMeta.category).toBe('development');
      expect(claudeMeta.requiresTmux).toBe(true);
      expect(claudeMeta.dependencies).toContain('claude');
    });
  });
});
