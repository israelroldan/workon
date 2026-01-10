import type { EventHandlerClass, EventMetadata } from '../types/index.js';

// Explicit imports for all events (works with bundled builds)
import { CwdEvent } from './core/cwd.js';
import { IdeEvent } from './core/ide.js';
import { WebEvent } from './core/web.js';
import { ClaudeEvent } from './extensions/claude.js';
import { DockerEvent } from './extensions/docker.js';
import { NpmEvent } from './extensions/npm.js';

// All available event classes
const ALL_EVENTS = [CwdEvent, IdeEvent, WebEvent, ClaudeEvent, DockerEvent, NpmEvent] as const;

/**
 * Event Registry for management of events
 * Uses explicit imports to work with bundled builds
 */
class EventRegistryClass {
  private _events = new Map<string, EventHandlerClass>();
  private _initialized = false;

  /**
   * Initialize the registry by registering all events
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    this.registerEvents();
    this._initialized = true;
  }

  /**
   * Register all event classes
   */
  private registerEvents(): void {
    for (const EventClass of ALL_EVENTS) {
      if (this.isValidEventClass(EventClass)) {
        this._events.set(EventClass.metadata.name, EventClass);
      }
    }
  }

  /**
   * Type guard to check if an object is a valid EventHandlerClass
   */
  private isValidEventClass(obj: unknown): obj is EventHandlerClass {
    if (typeof obj !== 'function' && typeof obj !== 'object') return false;
    if (obj === null) return false;

    const candidate = obj as Partial<EventHandlerClass>;
    return (
      candidate.metadata !== undefined &&
      typeof candidate.metadata.name === 'string' &&
      typeof candidate.metadata.displayName === 'string' &&
      candidate.validation !== undefined &&
      typeof candidate.validation.validateConfig === 'function' &&
      candidate.configuration !== undefined &&
      typeof candidate.configuration.configureInteractive === 'function' &&
      candidate.processing !== undefined &&
      typeof candidate.processing.processEvent === 'function'
    );
  }

  /**
   * Get all valid event names from registered events
   */
  getValidEventNames(): string[] {
    this.ensureInitialized();
    return Array.from(this._events.keys());
  }

  /**
   * Get event by name
   */
  getEventByName(name: string): EventHandlerClass | null {
    this.ensureInitialized();
    return this._events.get(name) ?? null;
  }

  /**
   * Get all events for management UI
   */
  getEventsForManageUI(): Array<{ name: string; value: string; description: string }> {
    this.ensureInitialized();

    const events: Array<{ name: string; value: string; description: string }> = [];
    for (const [name, eventClass] of this._events) {
      events.push({
        name: eventClass.metadata.displayName,
        value: name,
        description: eventClass.metadata.description,
      });
    }

    return events.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get events that support tmux integration
   */
  getTmuxEnabledEvents(): Array<{ name: string; event: EventHandlerClass; priority: number }> {
    this.ensureInitialized();

    const tmuxEvents: Array<{ name: string; event: EventHandlerClass; priority: number }> = [];
    for (const [name, eventClass] of this._events) {
      const tmux = eventClass.tmux;
      if (tmux) {
        tmuxEvents.push({
          name,
          event: eventClass,
          priority: tmux.getLayoutPriority(),
        });
      }
    }

    return tmuxEvents.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all available events with their metadata
   */
  getAllEvents(): Array<{
    name: string;
    metadata: EventMetadata;
    hasValidation: boolean;
    hasConfiguration: boolean;
    hasProcessing: boolean;
    hasTmux: boolean;
    hasHelp: boolean;
  }> {
    this.ensureInitialized();

    const events = [];
    for (const [name, eventClass] of this._events) {
      events.push({
        name,
        metadata: eventClass.metadata,
        hasValidation: !!eventClass.validation,
        hasConfiguration: !!eventClass.configuration,
        hasProcessing: !!eventClass.processing,
        hasTmux: !!eventClass.tmux,
        hasHelp: !!eventClass.help,
      });
    }

    return events;
  }

  /**
   * Ensure registry is initialized
   */
  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('EventRegistry must be initialized before use. Call initialize() first.');
    }
  }

  /**
   * Clear the registry (useful for testing)
   */
  clear(): void {
    this._events.clear();
    this._initialized = false;
  }
}

// Export singleton instance
export const EventRegistry = new EventRegistryClass();
