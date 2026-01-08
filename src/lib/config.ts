import Conf from 'conf';
import type { AppConfig, ProjectConfig, ProjectDefaults } from '../types/index.js';

const TRANSIENT_PROPS = ['pkg', 'work'] as const;

export class Config {
  private _transient: Record<string, unknown> = {};
  private _store: Conf<AppConfig>;

  constructor() {
    this._store = new Conf<AppConfig>({
      projectName: 'workon',
    });
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

  set(key: string, value?: unknown): void {
    const rootKey = key.split('.')[0];
    if (TRANSIENT_PROPS.includes(rootKey as (typeof TRANSIENT_PROPS)[number])) {
      this._transient[key] = value;
    } else {
      if (value === undefined) {
        // Setting entire object
        this._store.set(key as keyof AppConfig, value as never);
      } else {
        this._store.set(key as keyof AppConfig, value as never);
      }
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

  getProjects(): Record<string, ProjectConfig> {
    return this.get<Record<string, ProjectConfig>>('projects') ?? {};
  }

  getProject(name: string): ProjectConfig | undefined {
    const projects = this.getProjects();
    return projects[name];
  }

  setProject(name: string, config: ProjectConfig): void {
    const projects = this.getProjects();
    projects[name] = config;
    this.set('projects', projects);
  }

  deleteProject(name: string): void {
    const projects = this.getProjects();
    delete projects[name];
    this.set('projects', projects);
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
