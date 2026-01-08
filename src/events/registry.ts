import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EventHandler, EventMetadata } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Event Registry for auto-discovery and management of events
 * Scans the events directory and provides unified access to all events
 */
class EventRegistryClass {
  private _events = new Map<string, EventHandler>();
  private _initialized = false;

  /**
   * Initialize the registry by discovering all events
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    await this.discoverEvents();
    this._initialized = true;
  }

  /**
   * Discover events from the events directory
   */
  private async discoverEvents(): Promise<void> {
    const eventsDir = __dirname;

    // Discover core events
    await this.discoverEventsInDirectory(join(eventsDir, 'core'));

    // Discover extension events
    await this.discoverEventsInDirectory(join(eventsDir, 'extensions'));
  }

  /**
   * Discover events in a specific directory
   */
  private async discoverEventsInDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Handle both directory-based (index.ts) and file-based events
      let eventFile: string | null = null;

      if (entry.isDirectory()) {
        const indexFile = join(dir, entry.name, 'index.js');
        if (existsSync(indexFile)) {
          eventFile = indexFile;
        }
      } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js') {
        eventFile = join(dir, entry.name);
      }

      if (eventFile) {
        try {
          const module = await import(eventFile);
          const EventClass = module.default || module[Object.keys(module)[0]];

          if (this.isValidEvent(EventClass)) {
            const metadata = EventClass.metadata as EventMetadata;
            this._events.set(metadata.name, EventClass);
          }
        } catch (error) {
          console.error(`Failed to load event from ${eventFile}:`, (error as Error).message);
        }
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
   * Get all valid event names from discovered events
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
