import File from 'phylo';
import path from 'path';
import { simpleGit } from 'simple-git';
import { getWorktreesRoot, isPathInside, normalizePath } from '../../lib/worktree.js';
import { select, checkbox, confirm, input } from '@inquirer/prompts';
import type { Config } from '../../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig } from '../../types/index.js';
import { EventRegistry } from '../../events/registry.js';
import { IDE_CHOICES } from '../../types/constants.js';

/**
 * Context about whether we're inside a git worktree
 */
export interface WorktreeInfo {
  isWorktree: boolean; // True if we're inside a worktree (not main repo)
  worktreePath: string | null; // Path to current worktree root (if in worktree)
  mainRepoPath: string; // Path to main repository
  worktreeName: string | null; // Name of worktree (directory name)
  branch: string | null; // Current branch in worktree
}

/**
 * Context returned when resolving a project from the current working directory
 */
export interface ProjectContext {
  projectPath: string; // Absolute path to main repo (even if in worktree)
  projectName: string | null; // Name if registered, null otherwise
  projectConfig: ProjectConfig | null;
  isRegistered: boolean;
  worktreeInfo: WorktreeInfo; // Info about worktree context
}

/**
 * One entry of `git worktree list --porcelain`
 */
interface WorktreeListEntry {
  path: string;
  branch: string;
}

/**
 * Parse `git worktree list --porcelain`. The first entry is always the main
 * worktree (or the repository itself, for a bare repo).
 */
async function listWorktreeEntries(
  git: ReturnType<typeof simpleGit>
): Promise<WorktreeListEntry[]> {
  const result = await git.raw(['worktree', 'list', '--porcelain']);
  const entries: WorktreeListEntry[] = [];

  for (const block of result.trim().split('\n\n')) {
    if (!block.trim()) continue;

    let wtPath = '';
    let branch = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) {
        wtPath = line.substring('worktree '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.substring('branch refs/heads/'.length);
      } else if (line === 'detached') {
        branch = '(detached)';
      }
    }
    if (wtPath) {
      entries.push({ path: wtPath, branch });
    }
  }

  return entries;
}

/**
 * Detect if we're inside a git worktree and get context about it
 */
export async function detectWorktreeContext(
  cwd: string = process.cwd()
): Promise<WorktreeInfo | null> {
  try {
    const git = simpleGit(cwd);

    // Check if we're in a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return null;
    }

    // Get the git directory and common directory
    // --git-dir returns the .git dir for current worktree
    // --git-common-dir returns the shared .git dir (main repo's .git)
    const gitDir = (await git.revparse(['--git-dir'])).trim();
    const gitCommonDir = (await git.revparse(['--git-common-dir'])).trim();
    const worktreeRoot = (await git.revparse(['--show-toplevel'])).trim();

    // Normalize paths for comparison
    const normalizedGitDir = path.resolve(cwd, gitDir);
    const normalizedCommonDir = path.resolve(cwd, gitCommonDir);

    // If git-dir and git-common-dir are different, we're in a worktree
    const isWorktree = normalizedGitDir !== normalizedCommonDir;

    // The first entry of `git worktree list` is authoritative for the main
    // worktree. Deriving it as dirname(--git-common-dir) is wrong for bare
    // repositories, where the common dir is the repo itself rather than
    // `<main>/.git`, and would hand back the repo's parent directory.
    const entries = await listWorktreeEntries(git);
    const mainRepoPath =
      entries[0]?.path ??
      (path.basename(normalizedCommonDir) === '.git'
        ? path.dirname(normalizedCommonDir)
        : normalizedCommonDir);

    if (!isWorktree) {
      // We're in the main repository
      return {
        isWorktree: false,
        worktreePath: null,
        mainRepoPath,
        worktreeName: null,
        branch: null,
      };
    }

    // Get current branch
    let branch: string | null = null;
    try {
      branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (branch === 'HEAD') branch = '(detached)';
    } catch {
      branch = '(detached)';
    }

    return {
      isWorktree: true,
      worktreePath: worktreeRoot,
      mainRepoPath,
      // Must match the name WorktreeManager.get() expects
      worktreeName: resolveWorktreeName(entries, worktreeRoot),
      branch,
    };
  } catch {
    return null;
  }
}

/**
 * Find a worktree's name from a parsed `git worktree list`
 * Mirrors WorktreeManager.parseWorktreeList so both agree on naming.
 */
function resolveWorktreeName(entries: WorktreeListEntry[], worktreePath: string): string {
  const entry = entries.find((e) => e.path === worktreePath);

  if (!entry) {
    // Shouldn't happen: git listed us as a worktree of this repo.
    return path.basename(worktreePath);
  }

  if (isPathInside(entry.path, getWorktreesRoot())) {
    // Managed worktree under ~/.workon/worktrees/{project}/
    return path.basename(entry.path);
  }

  // External worktree - use branch name converted to dir format, or basename
  return entry.branch && entry.branch !== '(detached)'
    ? entry.branch.replace(/\//g, '-')
    : path.basename(entry.path);
}

/**
 * Resolve the project from the current working directory
 * Finds the git root and checks if it's a registered project.
 * If inside a worktree, uses the main repo path for registration lookup.
 */
export async function resolveProjectFromCwd(
  config: Config,
  log: Logger
): Promise<ProjectContext | null> {
  const cwd = process.cwd();

  // Detect worktree context
  const worktreeInfo = await detectWorktreeContext(cwd);
  if (!worktreeInfo) {
    return null;
  }

  // Use the main repo path for project lookup (not worktree path)
  const projectPath = worktreeInfo.mainRepoPath;

  if (worktreeInfo.isWorktree) {
    log.debug(`Inside worktree '${worktreeInfo.worktreeName}', main repo at ${projectPath}`);
  }

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

    // Compare paths. projectPath comes from git as a realpath, so the
    // configured one has to be resolved too or a symlinked base directory
    // (e.g. ~/code pointing at another volume) never matches.
    if (normalizePath(configuredPath) === projectPath) {
      log.debug(`Found registered project '${name}' at ${projectPath}`);
      return {
        projectPath,
        projectName: name,
        projectConfig,
        isRegistered: true,
        worktreeInfo,
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
    worktreeInfo,
  };
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
