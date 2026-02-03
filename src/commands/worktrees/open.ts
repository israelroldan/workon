import { Command } from 'commander';
import chalk from 'chalk';
import type { Config } from '../../lib/config.js';
import type { Logger, Project } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { TmuxManager } from '../../lib/tmux.js';
import { resolveProjectPath } from './utils.js';
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
    .argument('<project>', 'Project name')
    .argument('<name>', 'Worktree name')
    .option('-d, --debug', 'Enable debug logging')
    .option('--shell', 'Output shell commands instead of spawning processes')
    .action(async (project: string, name: string, options: OpenOptions) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      await runWorktreeOpen(project, name, options, { config, log });
    });
}

export async function runWorktreeOpen(
  projectName: string,
  worktreeName: string,
  options: OpenOptions,
  ctx: WorktreesContext
): Promise<void> {
  const { config, log } = ctx;

  const projectPath = resolveProjectPath(projectName, config, log);
  if (!projectPath) {
    process.exit(1);
  }

  const manager = new WorktreeManager(projectPath);

  if (!(await manager.isGitRepository())) {
    log.error(`'${projectName}' is not a git repository`);
    process.exit(1);
  }

  const worktree = await manager.get(worktreeName);
  if (!worktree) {
    log.error(`Worktree '${worktreeName}' not found for project '${projectName}'`);
    const worktrees = await manager.listManagedWorktrees();
    if (worktrees.length > 0) {
      log.info('Available worktrees:');
      worktrees.forEach((wt) => log.info(`  - ${wt.name}`));
    }
    process.exit(1);
  }

  // Get project configuration and create a modified project for the worktree
  const projects = config.getProjects();
  const projectConfig = projects[projectName];
  const defaults = config.getDefaults();

  // Create a project instance with the worktree path
  const project = new ProjectClass(projectName, projectConfig, defaults) as unknown as Project;
  // Override the path to point to the worktree by using any to bypass type checking
  // since we're replacing the phylo File object with a simple path wrapper
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (project as any).path = { path: worktree.path, absolutePath: () => worktree.path };

  const tmux = new TmuxManager();
  const sessionName = tmux.getWorktreeSessionName(projectName, worktreeName);

  log.debug(`Opening worktree: ${worktreeName}`);
  log.debug(`Worktree path: ${worktree.path}`);
  log.debug(`Session name: ${sessionName}`);

  const isShellMode = options.shell || false;

  // Determine layout based on project events (similar to open.ts)
  const events = project.events || {};
  const hasClaudeEvent = !!events.claude;
  const hasNpmEvent = !!events.npm;

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
  project: Project,
  worktreePath: string,
  sessionName: string,
  tmux: TmuxManager,
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean }
): Promise<string[]> {
  const { hasClaudeEvent, hasNpmEvent } = eventFlags;

  // Get claude args if claude is enabled
  const claudeArgs = hasClaudeEvent ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent ? await getNpmCommand(project) : '';

  // Build tmux commands using a custom session name
  if (hasClaudeEvent && hasNpmEvent) {
    return buildThreePaneCommands(sessionName, worktreePath, claudeArgs, npmCommand, tmux);
  } else if (hasClaudeEvent) {
    return buildSplitClaudeCommands(sessionName, worktreePath, claudeArgs, tmux);
  } else if (hasNpmEvent) {
    return buildTwoPaneNpmCommands(sessionName, worktreePath, npmCommand, tmux);
  } else {
    // Just open a shell in the worktree
    return buildSimpleSessionCommands(sessionName, worktreePath, tmux);
  }
}

async function createWorktreeTmuxSession(
  project: Project,
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

  const claudeArgs = hasClaudeEvent ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent ? await getNpmCommand(project) : '';

  // Create appropriate session based on events
  if (hasClaudeEvent && hasNpmEvent) {
    await createThreePaneSession(sessionName, worktreePath, claudeArgs, npmCommand);
  } else if (hasClaudeEvent) {
    await createSplitClaudeSession(sessionName, worktreePath, claudeArgs);
  } else if (hasNpmEvent) {
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
