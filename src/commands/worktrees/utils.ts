import File from 'phylo';
import path from 'path';
import { simpleGit } from 'simple-git';
import { select, checkbox, confirm, input } from '@inquirer/prompts';
import type { Config } from '../../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig } from '../../types/index.js';
import { EventRegistry } from '../../events/registry.js';
import { IDE_CHOICES } from '../../types/constants.js';

/**
 * Context returned when resolving a project from the current working directory
 */
export interface ProjectContext {
  projectPath: string; // Absolute path to git root
  projectName: string | null; // Name if registered, null otherwise
  projectConfig: ProjectConfig | null;
  isRegistered: boolean;
}

/**
 * Resolve the project from the current working directory
 * Finds the git root and checks if it's a registered project
 */
export async function resolveProjectFromCwd(
  config: Config,
  log: Logger
): Promise<ProjectContext | null> {
  const cwd = process.cwd();

  try {
    const git = simpleGit(cwd);

    // Check if we're in a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return null;
    }

    // Get the git root directory
    const gitRoot = await git.revparse(['--show-toplevel']);
    const projectPath = gitRoot.trim();

    // Search registered projects by comparing absolute paths
    const projects = config.getProjects();
    const defaults = config.getDefaults();
    const basePath = defaults?.base || '';

    for (const [name, projectConfig] of Object.entries(projects)) {
      // Skip branch configs (contain #)
      if (name.includes('#')) continue;

      // Resolve the configured path to absolute
      let configuredPath: string;
      const configPath = File.from(projectConfig.path);

      if (configPath.path.startsWith('/') || configPath.path.startsWith('~')) {
        configuredPath = configPath.absolutify().path;
      } else if (basePath) {
        configuredPath = File.from(basePath).absolutify().join(projectConfig.path).path;
      } else {
        configuredPath = configPath.absolutify().path;
      }

      // Compare paths
      if (configuredPath === projectPath) {
        log.debug(`Found registered project '${name}' at ${projectPath}`);
        return {
          projectPath,
          projectName: name,
          projectConfig,
          isRegistered: true,
        };
      }
    }

    // Not registered
    log.debug(`Project at ${projectPath} is not registered`);
    return {
      projectPath,
      projectName: null,
      projectConfig: null,
      isRegistered: false,
    };
  } catch (error) {
    log.debug(`Error resolving project from CWD: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Prompt to register a project that was found but not registered
 * Uses similar logic to the interactive add flow
 */
export async function promptToRegisterProject(
  projectPath: string,
  config: Config,
  log: Logger
): Promise<{ projectName: string; projectConfig: ProjectConfig } | null> {
  const shouldAdd = await confirm({
    message: 'This project is not registered. Would you like to add it now?',
    default: true,
  });

  if (!shouldAdd) {
    return null;
  }

  const defaults = config.getDefaults();
  const projects = config.getProjects();

  // Suggest a name based on directory
  const suggestedName = path.basename(projectPath);

  const name = await input({
    message: 'Project name:',
    default: suggestedName,
    validate: (value) => {
      if (!value.trim()) return 'Name is required';
      if (!/^[\w-]+$/.test(value))
        return 'Name can only contain letters, numbers, underscores, and hyphens';
      if (value in projects) return 'Project already exists';
      return true;
    },
  });

  // Calculate relative path if we have a base
  let relativePath = projectPath;
  if (defaults?.base) {
    const baseDir = File.from(defaults.base).absolutify();
    const projectFile = File.from(projectPath);
    try {
      if (projectFile.path.startsWith(baseDir.path)) {
        relativePath = projectFile.relativize(baseDir.path).path;
      }
    } catch {
      // Keep absolute path
    }
  }

  // IDE selection
  const ide = await select({
    message: 'Select IDE:',
    choices: IDE_CHOICES,
    default: 'vscode',
  });

  // Event selection
  const availableEvents = EventRegistry.getEventsForManageUI();
  const selectedEvents = await checkbox({
    message: 'Select events to enable:',
    choices: availableEvents.map((e) => ({
      name: `${e.name} - ${e.description}`,
      value: e.value,
      checked: e.value === 'cwd' || e.value === 'ide' || e.value === 'claude',
    })),
  });

  const events: EventsConfig = {};
  for (const eventName of selectedEvents) {
    const eventHandler = EventRegistry.getEventByName(eventName);
    if (eventHandler) {
      const eventConfig = await eventHandler.configuration.configureInteractive();
      events[eventName as keyof EventsConfig] = eventConfig as EventsConfig[keyof EventsConfig];
    }
  }

  const projectConfig: ProjectConfig = {
    path: relativePath,
    ide,
    events,
  };

  await config.setProjectSafe(name, projectConfig);
  log.info(`Project '${name}' registered successfully!`);

  return { projectName: name, projectConfig };
}

/**
 * Resolve a project name to its absolute path
 */
export function resolveProjectPath(
  projectName: string,
  config: Config,
  log: Logger
): string | null {
  const projects = config.getProjects();
  const defaults = config.getDefaults();

  if (!(projectName in projects)) {
    log.error(`Project '${projectName}' not found.`);
    log.info(`Run 'workon' to see available projects.`);
    return null;
  }

  const projectConfig = projects[projectName];
  const basePath = defaults?.base || '';

  let projectPath: string;
  // Check if the project path is already absolute
  const configPath = File.from(projectConfig.path);
  if (configPath.path.startsWith('/') || configPath.path.startsWith('~')) {
    // Path is absolute, use it directly
    projectPath = configPath.absolutify().path;
  } else if (basePath) {
    // Relative path, prepend base
    projectPath = File.from(basePath).absolutify().join(projectConfig.path).path;
  } else {
    // No base, try to absolutify the relative path
    projectPath = configPath.absolutify().path;
  }

  return projectPath;
}

/**
 * Format a branch name for display (truncate if too long)
 */
export function formatBranchName(branch: string, maxLength = 30): string {
  if (branch.length <= maxLength) {
    return branch;
  }
  return branch.substring(0, maxLength - 3) + '...';
}
