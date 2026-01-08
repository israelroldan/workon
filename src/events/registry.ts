import type { EventHandler, EventMetadata } from '../types/index.js';

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
  private _events = new Map<string, EventHandler>();
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
      if (this.isValidEvent(EventClass)) {
        const metadata = (EventClass as unknown as { metadata: EventMetadata }).metadata;
        this._events.set(metadata.name, EventClass as unknown as EventHandler);
      }
    }
  }

  /**
   * Validate if a class is a proper event
   */
  private isValidEvent(EventClass: unknown): boolean {
    try {
      if (typeof EventClass !== 'function') return false;

      const metadata = (EventClass as { metadata?: EventMetadata }).metadata;
      return (
        metadata !== undefined &&
        typeof metadata.name === 'string' &&
        typeof metadata.displayName === 'string' &&
        typeof (EventClass as { validation?: object }).validation === 'object' &&
        typeof (EventClass as { configuration?: object }).configuration === 'object' &&
        typeof (EventClass as { processing?: object }).processing === 'object'
      );
    } catch {
      return false;
    }
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
  getEventByName(name: string): EventHandler | null {
    this.ensureInitialized();
    return this._events.get(name) ?? null;
  }

  /**
   * Get all events for management UI
   */
  getEventsForManageUI(): Array<{ name: string; value: string; description: string }> {
    this.ensureInitialized();

    const events: Array<{ name: string; value: string; description: string }> = [];
    for (const [name, EventClass] of this._events) {
      const metadata = (EventClass as { metadata: EventMetadata }).metadata;
      events.push({
        name: metadata.displayName,
        value: name,
        description: metadata.description,
      });
    }

    return events.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get events that support tmux integration
   */
  getTmuxEnabledEvents(): Array<{ name: string; event: EventHandler; priority: number }> {
    this.ensureInitialized();

    const tmuxEvents: Array<{ name: string; event: EventHandler; priority: number }> = [];
    for (const [name, EventClass] of this._events) {
      const tmux = (EventClass as { tmux?: { getLayoutPriority?: () => number } }).tmux;
      if (tmux) {
        tmuxEvents.push({
          name,
          event: EventClass,
          priority: tmux.getLayoutPriority ? tmux.getLayoutPriority() : 0,
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
    for (const [name, EventClass] of this._events) {
      const typedClass = EventClass as {
        metadata: EventMetadata;
        validation?: object;
        configuration?: object;
        processing?: object;
        tmux?: object;
        help?: object;
      };
      events.push({
        name,
        metadata: typedClass.metadata,
        hasValidation: !!typedClass.validation,
        hasConfiguration: !!typedClass.configuration,
        hasProcessing: !!typedClass.processing,
        hasTmux: !!typedClass.tmux,
        hasHelp: !!typedClass.help,
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
