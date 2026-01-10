import File from 'phylo';
import { simpleGit } from 'simple-git';
import { Config } from './config.js';
import { Project } from './project.js';
import type { Logger, ProjectConfig, ProjectDefaults } from '../types/index.js';

export class BaseEnvironment {
  $isProjectEnvironment = false as const;
}

export class ProjectEnvironment {
  $isProjectEnvironment = true as const;
  project: Project;

  constructor(projectCfg: ProjectConfig & { name: string; exactName?: string }) {
    this.project = new Project(projectCfg.name, projectCfg);
  }

  static load(
    cfg: ProjectConfig & { name: string },
    defaults?: ProjectDefaults
  ): ProjectEnvironment {
    const project = new Project(cfg.name, cfg, defaults);
    return new ProjectEnvironment({ ...cfg, name: project.name });
  }
}

export type Environment = BaseEnvironment | ProjectEnvironment;

interface ProjectWithPath {
  name: string;
  path: ReturnType<typeof File.from>;
  ide?: ProjectConfig['ide'];
  homepage?: string;
  events: ProjectConfig['events'];
  branch?: string;
}

export class EnvironmentRecognizer {
  private static config: Config;
  private static log: Logger;
  private static projects: ProjectWithPath[] = [];
  private static configured = false;

  static configure(config: Config, log: Logger): void {
    if (this.configured) {
      return;
    }
    this.config = config;
    this.log = log;
    this.configured = true;
  }

  static async recognize(dir: string | ReturnType<typeof File.from>): Promise<Environment> {
    this.ensureConfigured();

    const theDir = File.from(dir).canonicalize();
    this.log.debug('Directory to recognize is: ' + theDir.canonicalPath());

    const allProjects = this.getAllProjects();
    const matching = allProjects.filter((p) => p.path.canonicalPath() === theDir.path);

    if (matching.length === 0) {
      return new BaseEnvironment();
    }

    this.log.debug(`Found ${matching.length} matching projects`);

    // Find base project (without branch suffix)
    const base = matching.find((p) => !p.name.includes('#')) ?? matching[0];
    this.log.debug('Base project is: ' + base.name);

    // Try to detect git branch
    const gitDir = base.path.up('.git');
    if (gitDir) {
      try {
        const git = simpleGit(gitDir.path);
        const branchSummary = await git.branchLocal();
        (base as ProjectWithPath & { branch?: string }).branch = branchSummary.current;
      } catch (error) {
        this.log.debug(`Git branch detection failed: ${(error as Error).message}`);
      }
    }

    return this.getProjectEnvironment(base, matching);
  }

  private static getAllProjects(refresh = false): ProjectWithPath[] {
    if (this.projects.length > 0 && !refresh) {
      return this.projects;
    }

    const defaults = this.config.getDefaults();
    if (!defaults?.base) {
      this.projects = [];
      return this.projects;
    }

    const baseDir = File.from(defaults.base);
    const projectsMap = this.config.getProjects();

    this.projects = Object.entries(projectsMap).map(([name, project]) => ({
      ...project,
      name,
      path: baseDir.join(project.path),
    }));

    return this.projects;
  }

  private static getProjectEnvironment(
    base: ProjectWithPath & { branch?: string },
    _matching: ProjectWithPath[]
  ): ProjectEnvironment {
    const exactName = `${base.name}#${base.branch}`;

    // Check if there's an exact branch-specific config
    const exactProj = this.projects.find((p) => p.name === exactName);

    // Convert ProjectWithPath to ProjectConfig format (path as string)
    const toProjectConfig = (
      p: ProjectWithPath
    ): ProjectConfig & { name: string; exactName?: string } => ({
      name: p.name,
      path: p.path.path, // Convert PhyloFile to string path
      ide: p.ide,
      homepage: p.homepage,
      events: p.events,
      branch: p.branch,
      exactName,
    });

    if (exactProj) {
      return new ProjectEnvironment({ ...toProjectConfig(exactProj), branch: base.branch });
    }

    return new ProjectEnvironment(toProjectConfig(base));
  }

  private static ensureConfigured(): void {
    if (!this.configured) {
      // Use singleton instance to avoid multiple Config instances
      this.config = Config.getInstance();
      // Create a no-op logger if not configured
      this.log = {
        debug: () => {},
        info: () => {},
        log: () => {},
        warn: () => {},
        error: () => {},
        setLogLevel: () => {},
      };
      this.configured = true;
    }
  }
}
