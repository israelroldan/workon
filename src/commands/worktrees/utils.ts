import File from 'phylo';
import type { Config } from '../../lib/config.js';
import type { Logger } from '../../types/index.js';

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
