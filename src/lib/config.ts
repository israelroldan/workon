import Conf from 'conf';
import { openSync, closeSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AppConfig, ProjectConfig, ProjectDefaults } from '../types/index.js';

const TRANSIENT_PROPS = ['pkg', 'work'] as const;

/**
 * Simple file-based lock for preventing concurrent writes.
 * Uses exclusive file creation to ensure only one process can hold the lock.
 */
class FileLock {
  private lockPath: string;
  private fd: number | null = null;
  private static readonly LOCK_TIMEOUT_MS = 5000;
  private static readonly RETRY_INTERVAL_MS = 50;

  constructor(configPath: string) {
    this.lockPath = `${configPath}.lock`;
  }

  async acquire(): Promise<void> {
    const startTime = Date.now();
    const lockDir = dirname(this.lockPath);

    // Ensure directory exists
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true });
    }

    while (Date.now() - startTime < FileLock.LOCK_TIMEOUT_MS) {
      try {
        // Try to create lock file exclusively (fails if exists)
        this.fd = openSync(this.lockPath, 'wx');
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock file exists, check if it's stale (older than timeout)
          try {
            const stat = await import('fs').then((fs) => fs.promises.stat(this.lockPath));
            const age = Date.now() - stat.mtimeMs;
            if (age > FileLock.LOCK_TIMEOUT_MS) {
              // Stale lock, try to remove it
              try {
                unlinkSync(this.lockPath);
              } catch {
                // Another process might have removed it
              }
            }
          } catch {
            // Lock file might have been removed, try again
          }
          // Wait and retry
          await new Promise((resolve) => setTimeout(resolve, FileLock.RETRY_INTERVAL_MS));
        } else {
          throw error;
        }
      }
    }
    throw new Error('Failed to acquire config lock: timeout');
  }

  release(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // Ignore close errors
      }
      this.fd = null;
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Ignore unlink errors (file might not exist)
    }
  }
}

/**
 * Config class with singleton pattern and file locking to prevent
 * race conditions that could clear the config.
 */
export class Config {
  private static _instance: Config | null = null;
  private _transient: Record<string, unknown> = {};
  // Using definite assignment assertion since singleton pattern may return existing instance
  private _store!: Conf<AppConfig>;
  private _lock!: FileLock;

  constructor() {
    // If an instance already exists, return it (soft singleton)
    // This allows tests to create new instances while preventing
    // accidental multiple instances in production
    if (Config._instance && process.env.NODE_ENV !== 'test') {
      return Config._instance;
    }

    // Allow overriding config directory via env var (used for test isolation)
    // This is necessary because `conf` on macOS ignores XDG_CONFIG_HOME
    this._store = new Conf<AppConfig>({
      projectName: 'workon',
      ...(process.env.WORKON_CONFIG_DIR && { cwd: process.env.WORKON_CONFIG_DIR }),
    });
    this._lock = new FileLock(this._store.path);

    if (process.env.NODE_ENV !== 'test') {
      Config._instance = this;
    }
  }

  /**
   * Get the singleton instance (creates one if needed)
   */
  static getInstance(): Config {
    if (!Config._instance) {
      Config._instance = new Config();
    }
    return Config._instance;
  }

  /**
   * Reset the singleton instance (for testing purposes)
   */
  static resetInstance(): void {
    Config._instance = null;
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const rootKey = key.split('.')[0];
    if (TRANSIENT_PROPS.includes(rootKey as (typeof TRANSIENT_PROPS)[number])) {
      return (this._transient[key] as T) ?? defaultValue;
    }
    return this._store.get(key as keyof AppConfig, defaultValue as AppConfig[keyof AppConfig]) as
      | T
      | undefined;
  }

  set(key: string, value: unknown): void {
    const rootKey = key.split('.')[0];
    if (TRANSIENT_PROPS.includes(rootKey as (typeof TRANSIENT_PROPS)[number])) {
      this._transient[key] = value;
    } else {
      // Don't allow setting undefined values - use delete() instead
      if (value === undefined) {
        throw new Error(`Cannot set '${key}' to undefined. Use delete() to remove keys.`);
      }
      this._store.set(key as keyof AppConfig, value as never);
    }
  }

  has(key: string): boolean {
    const rootKey = key.split('.')[0];
    if (TRANSIENT_PROPS.includes(rootKey as (typeof TRANSIENT_PROPS)[number])) {
      return Object.prototype.hasOwnProperty.call(this._transient, key);
    }
    return this._store.has(key as keyof AppConfig);
  }

  delete(key: string): void {
    const rootKey = key.split('.')[0];
    if (TRANSIENT_PROPS.includes(rootKey as (typeof TRANSIENT_PROPS)[number])) {
      delete this._transient[key];
    } else {
      this._store.delete(key as keyof AppConfig);
    }
  }

  /**
   * Get all projects. Returns a fresh copy from the store.
   */
  getProjects(): Record<string, ProjectConfig> {
    return this.get<Record<string, ProjectConfig>>('projects') ?? {};
  }

  getProject(name: string): ProjectConfig | undefined {
    const projects = this.getProjects();
    return projects[name];
  }

  /**
   * Set a project with file locking to prevent race conditions.
   * This ensures atomic read-modify-write operations.
   */
  async setProjectSafe(name: string, config: ProjectConfig): Promise<void> {
    await this._lock.acquire();
    try {
      // Re-read projects from disk to get latest state
      const freshProjects = this._store.get('projects') ?? {};
      freshProjects[name] = config;
      this._store.set('projects', freshProjects as never);
    } finally {
      this._lock.release();
    }
  }

  /**
   * Synchronous version of setProject for backwards compatibility.
   * Note: This is less safe than setProjectSafe() in concurrent scenarios.
   * Consider migrating to setProjectSafe() for critical operations.
   */
  setProject(name: string, config: ProjectConfig): void {
    // Re-read from store to minimize race window
    const freshProjects = this._store.get('projects') ?? {};
    freshProjects[name] = config;
    this._store.set('projects', freshProjects as never);
  }

  /**
   * Delete a project with file locking to prevent race conditions.
   */
  async deleteProjectSafe(name: string): Promise<void> {
    await this._lock.acquire();
    try {
      // Re-read projects from disk to get latest state
      const freshProjects = this._store.get('projects') ?? {};
      delete freshProjects[name];
      this._store.set('projects', freshProjects as never);
    } finally {
      this._lock.release();
    }
  }

  /**
   * Synchronous version of deleteProject for backwards compatibility.
   */
  deleteProject(name: string): void {
    // Re-read from store to minimize race window
    const freshProjects = this._store.get('projects') ?? {};
    delete freshProjects[name];
    this._store.set('projects', freshProjects as never);
  }

  getDefaults(): ProjectDefaults | undefined {
    return this.get<ProjectDefaults>('project_defaults');
  }

  setDefaults(defaults: ProjectDefaults): void {
    this.set('project_defaults', defaults);
  }

  get path(): string {
    return this._store.path;
  }

  get store(): AppConfig {
    return this._store.store;
  }
}
