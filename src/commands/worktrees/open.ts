import { Command } from 'commander';
import chalk from 'chalk';
import File from 'phylo';
import path from 'path';
import type { Config } from '../../lib/config.js';
import type { Logger, Project } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { TmuxManager } from '../../lib/tmux.js';
import { resolveProjectFromCwd, promptToRegisterProject, type ProjectContext } from './utils.js';
import { blockIfInWorktree } from './index.js';
import { Project as ProjectClass } from '../../lib/project.js';

interface WorktreesContext {
  config: Config;
  log: Logger;
}

interface OpenOptions {
  debug?: boolean;
  shell?: boolean;
}

export function createOpenCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('open')
    .description('Open a workon session in a worktree')
    .argument('<name>', 'Worktree name')
    .option('-d, --debug', 'Enable debug logging')
    .option('--shell', 'Output shell commands instead of spawning processes')
    .action(async (name: string, options: OpenOptions) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      const projectCtx = await resolveProjectFromCwd(config, log);

      if (!projectCtx) {
        log.error('Not in a git repository. Run this command from within a git project.');
        process.exit(1);
      }

      // Block if running from inside a worktree
      if (blockIfInWorktree(projectCtx, log)) {
        process.exit(1);
      }

      // For full tmux layout, we need registration (for events config)
      if (!projectCtx.isRegistered) {
        log.warn('Project is not registered. Opening with basic shell layout.');
        const shouldRegister = await promptToRegisterProject(projectCtx.projectPath, config, log);
        if (shouldRegister) {
          projectCtx.projectName = shouldRegister.projectName;
          projectCtx.projectConfig = shouldRegister.projectConfig;
          projectCtx.isRegistered = true;
        }
      }

      await runWorktreeOpen(projectCtx, name, options, { config, log });
    });
}

export async function runWorktreeOpen(
  projectCtx: ProjectContext,
  worktreeName: string,
  options: OpenOptions,
  ctx: WorktreesContext
): Promise<void> {
  const { config, log } = ctx;
  const { projectPath, projectName, projectConfig, isRegistered } = projectCtx;
  const displayName = projectName || path.basename(projectPath);

  const manager = new WorktreeManager(projectPath);

  const worktree = await manager.get(worktreeName);
  if (!worktree) {
    log.error(`Worktree '${worktreeName}' not found for '${displayName}'`);
    const worktrees = await manager.listManagedWorktrees();
    if (worktrees.length > 0) {
      log.info('Available worktrees:');
      worktrees.forEach((wt) => log.info(`  - ${wt.name}`));
    }
    process.exit(1);
  }

  const defaults = config.getDefaults();
  const tmux = new TmuxManager();
  const sessionName = tmux.getWorktreeSessionName(displayName, worktreeName);

  log.debug(`Opening worktree: ${worktreeName}`);
  log.debug(`Worktree path: ${worktree.path}`);
  log.debug(`Session name: ${sessionName}`);

  const isShellMode = options.shell || false;

  // Determine layout based on project events (if registered)
  let project: Project | null = null;
  let hasClaudeEvent = false;
  let hasNpmEvent = false;

  if (isRegistered && projectName && projectConfig) {
    // Create a project instance with the worktree path
    project = new ProjectClass(projectName, projectConfig, defaults) as unknown as Project;
    // Override the internal _path directly to bypass the setter which would join with base
    // The worktree path is already absolute, so we just need to wrap it in a phylo File object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any)._path = File.from(worktree.path).absolutify();

    const events = project.events || {};
    hasClaudeEvent = !!events.claude;
    hasNpmEvent = !!events.npm;
  }

  if (isShellMode) {
    const shellCommands = await buildWorktreeShellCommands(
      project,
      worktree.path,
      sessionName,
      tmux,
      { hasClaudeEvent, hasNpmEvent }
    );
    console.log(shellCommands.join('\n'));
  } else {
    if (await tmux.isTmuxAvailable()) {
      try {
        await createWorktreeTmuxSession(project, worktree.path, sessionName, tmux, {
          hasClaudeEvent,
          hasNpmEvent,
        });
        await tmux.attachToSession(sessionName);
        console.log(
          chalk.green(`Opened worktree '${worktreeName}' in tmux session '${sessionName}'`)
        );
      } catch (error) {
        log.error(`Failed to create tmux session: ${(error as Error).message}`);
        process.exit(1);
      }
    } else {
      log.error('tmux is not available. Install with: brew install tmux');
      log.info(`Worktree path: ${worktree.path}`);
      process.exit(1);
    }
  }
}

async function buildWorktreeShellCommands(
  project: Project | null,
  worktreePath: string,
  sessionName: string,
  tmux: TmuxManager,
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean }
): Promise<string[]> {
  const { hasClaudeEvent, hasNpmEvent } = eventFlags;

  // Get claude args if claude is enabled and project exists
  const claudeArgs = hasClaudeEvent && project ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent && project ? await getNpmCommand(project) : '';

  // Build tmux commands using a custom session name
  if (hasClaudeEvent && hasNpmEvent && project) {
    return buildThreePaneCommands(sessionName, worktreePath, claudeArgs, npmCommand, tmux);
  } else if (hasClaudeEvent && project) {
    return buildSplitClaudeCommands(sessionName, worktreePath, claudeArgs, tmux);
  } else if (hasNpmEvent && project) {
    return buildTwoPaneNpmCommands(sessionName, worktreePath, npmCommand, tmux);
  } else {
    // Just open a shell in the worktree
    return buildSimpleSessionCommands(sessionName, worktreePath, tmux);
  }
}

async function createWorktreeTmuxSession(
  project: Project | null,
  worktreePath: string,
  sessionName: string,
  tmux: TmuxManager,
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean }
): Promise<void> {
  const { hasClaudeEvent, hasNpmEvent } = eventFlags;

  // Kill existing session if it exists
  if (await tmux.sessionExists(sessionName)) {
    await tmux.killSession(sessionName);
  }

  // Get claude args if claude is enabled and project exists
  const claudeArgs = hasClaudeEvent && project ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent && project ? await getNpmCommand(project) : '';

  // Create appropriate session based on events
  if (hasClaudeEvent && hasNpmEvent && project) {
    await createThreePaneSession(sessionName, worktreePath, claudeArgs, npmCommand);
  } else if (hasClaudeEvent && project) {
    await createSplitClaudeSession(sessionName, worktreePath, claudeArgs);
  } else if (hasNpmEvent && project) {
    await createTwoPaneNpmSession(sessionName, worktreePath, npmCommand);
  } else {
    await createSimpleSession(sessionName, worktreePath);
  }
}

function getClaudeArgs(project: Project): string[] {
  const claudeConfig = project.events.claude;
  const userFlags =
    typeof claudeConfig === 'object' && claudeConfig.flags ? claudeConfig.flags : [];
  return ['--dangerously-skip-permissions', ...userFlags];
}

async function getNpmCommand(project: Project): Promise<string> {
  const npmConfig = project.events.npm;
  const { NpmEvent } = await import('../../events/extensions/npm.js');
  return NpmEvent.getNpmCommand(npmConfig);
}

// Shell command builders
import { escapeForSingleQuotes } from '../../lib/sanitize.js';

function wrapWithShellFallback(command: string): string {
  return `${command}; exec $SHELL`;
}

function buildSimpleSessionCommands(
  sessionName: string,
  path: string,
  _tmux: TmuxManager
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);

  return [
    `# Create tmux session for worktree`,
    `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`,
    getAttachCommand(sessionName),
  ];
}

function buildSplitClaudeCommands(
  sessionName: string,
  path: string,
  claudeArgs: string[],
  _tmux: TmuxManager
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));

  return [
    `# Create tmux split session for worktree`,
    `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
    `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`,
    `tmux select-pane -t '${escapedSession}:0.0'`,
    getAttachCommand(sessionName),
  ];
}

function buildTwoPaneNpmCommands(
  sessionName: string,
  path: string,
  npmCommand: string,
  _tmux: TmuxManager
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  return [
    `# Create tmux two-pane session with npm for worktree`,
    `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`,
    `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}' '${wrappedNpmCmd}'`,
    `tmux select-pane -t '${escapedSession}:0.0'`,
    getAttachCommand(sessionName),
  ];
}

function buildThreePaneCommands(
  sessionName: string,
  path: string,
  claudeArgs: string[],
  npmCommand: string,
  _tmux: TmuxManager
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  return [
    `# Create tmux three-pane session for worktree`,
    `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
    `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`,
    `tmux split-window -v -t '${escapedSession}:0.1' -c '${escapedPath}' '${wrappedNpmCmd}'`,
    `tmux resize-pane -t '${escapedSession}:0.2' -y 10`,
    `tmux select-pane -t '${escapedSession}:0.0'`,
    getAttachCommand(sessionName),
  ];
}

function getAttachCommand(sessionName: string): string {
  const escapedSession = escapeForSingleQuotes(sessionName);

  if (process.env.TMUX) {
    return `tmux switch-client -t '${escapedSession}'`;
  }

  const isITerm =
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.LC_TERMINAL === 'iTerm2' ||
    process.env.ITERM_SESSION_ID;
  const useiTermIntegration = isITerm && !process.env.TMUX_CC_NOT_SUPPORTED;

  if (useiTermIntegration) {
    return `tmux -CC attach-session -t '${escapedSession}'`;
  }
  return `tmux attach-session -t '${escapedSession}'`;
}

// Direct session creation functions using exec
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

async function createSimpleSession(sessionName: string, path: string): Promise<void> {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);

  await exec(`tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`);
}

async function createSplitClaudeSession(
  sessionName: string,
  path: string,
  claudeArgs: string[]
): Promise<void> {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));

  await exec(
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`
  );
  await exec(`tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`);
  await exec(`tmux select-pane -t '${escapedSession}:0.0'`);
}

async function createTwoPaneNpmSession(
  sessionName: string,
  path: string,
  npmCommand: string
): Promise<void> {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  await exec(`tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`);
  await exec(`tmux split-window -h -t '${escapedSession}' -c '${escapedPath}' '${wrappedNpmCmd}'`);
  await exec(`tmux select-pane -t '${escapedSession}:0.0'`);
}

async function createThreePaneSession(
  sessionName: string,
  path: string,
  claudeArgs: string[],
  npmCommand: string
): Promise<void> {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  await exec(
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`
  );
  await exec(`tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`);
  await exec(
    `tmux split-window -v -t '${escapedSession}:0.1' -c '${escapedPath}' '${wrappedNpmCmd}'`
  );
  await exec(`tmux resize-pane -t '${escapedSession}:0.2' -y 10`);
  await exec(`tmux select-pane -t '${escapedSession}:0.0'`);
}
