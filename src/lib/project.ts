import File from 'phylo';
import deepAssign from 'deep-assign';
import type { ProjectConfig, EventsConfig, IdeType, ProjectDefaults } from '../types/index.js';

export class Project {
  name: string;
  private _base?: ReturnType<typeof File.from>;
  private _path?: ReturnType<typeof File.from>;
  private _ide?: IdeType;
  private _events: EventsConfig = {};
  private _branch?: string;
  private _homepage?: string;
  private _defaults: ProjectDefaults;
  private _initialCfg: ProjectConfig;

  constructor(name: string, cfg?: Partial<ProjectConfig>, defaults?: ProjectDefaults) {
    this._defaults = defaults ?? { base: '' };
    this._initialCfg = { path: name, events: {}, ...cfg };

    this.name = cfg?.name ?? name;

    // Apply defaults first, then config
    const merged = deepAssign({}, this._defaults, this._initialCfg) as ProjectConfig & {
      base?: string;
    };

    if (merged.base) {
      this.base = merged.base;
    }
    if (merged.path) {
      this.path = merged.path;
    }
    if (merged.ide) {
      this._ide = merged.ide;
    }
    if (merged.events) {
      this._events = merged.events;
    }
    if (merged.branch) {
      this._branch = merged.branch;
    }
    if (merged.homepage) {
      this._homepage = merged.homepage;
    }
  }

  set base(path: string) {
    this._base = File.from(path).absolutify();
  }

  get base(): ReturnType<typeof File.from> | undefined {
    return this._base;
  }

  set ide(cmd: IdeType | undefined) {
    this._ide = cmd;
  }

  get ide(): IdeType | undefined {
    return this._ide;
  }

  set events(eventCfg: EventsConfig) {
    this._events = eventCfg;
  }

  get events(): EventsConfig {
    return this._events;
  }

  set path(path: string) {
    const pathFile = File.from(path);
    if (this._base && !pathFile.isAbsolute()) {
      this._path = this._base.join(path);
    } else {
      this._path = pathFile;
    }
    this._path = this._path.absolutify();
  }

  get path(): ReturnType<typeof File.from> {
    if (!this._path) {
      throw new Error('Project path not set');
    }
    return this._path;
  }

  set branch(branch: string | undefined) {
    this._branch = branch;
  }

  get branch(): string | undefined {
    return this._branch;
  }

  set homepage(url: string | undefined) {
    this._homepage = url;
  }

  get homepage(): string | undefined {
    return this._homepage;
  }

  static $isProject = true;
  $isProject = true;
}
