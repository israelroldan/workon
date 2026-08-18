import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { existsSync } from 'fs';
import type { Config } from '../../lib/config.js';
import type { Logger, Project } from '../../types/index.js';
import { WorktreeManager } from '../../lib/worktree.js';
import { TmuxManager, sessionTarget, paneTarget } from '../../lib/tmux.js';
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
  attach?: boolean; // Default true, set false to create session without attaching
  yes?: boolean;
  recreate?: boolean; // Tear down and rebuild an existing session
}

export function createOpenCommand(ctx: WorktreesContext): Command {
  const { config, log } = ctx;

  return new Command('open')
    .description('Open a workon session in a worktree')
    .argument('<name>', 'Worktree name')
    .option('-d, --debug', 'Enable debug logging')
    .option('--shell', 'Output shell commands instead of spawning processes')
    .option('-y, --yes', 'Skip all confirmation prompts (non-interactive mode)')
    .option('-r, --recreate', 'Rebuild the tmux session even if one already exists')
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
        if (options.yes) {
          log.info('Project is not registered. Opening with basic shell layout.');
        } else {
          log.warn('Project is not registered. Opening with basic shell layout.');
          const shouldRegister = await promptToRegisterProject(projectCtx.projectPath, config, log);
          if (shouldRegister) {
            projectCtx.projectName = shouldRegister.projectName;
            projectCtx.projectConfig = shouldRegister.projectConfig;
            projectCtx.isRegistered = true;
          }
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

  const manager = new WorktreeManager(projectPath, projectName ?? undefined);

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

  if (!existsSync(worktree.path)) {
    log.error(`Worktree directory is missing from disk: ${worktree.path}`);
    log.info(`Clean up the stale entry with: workon worktrees remove ${worktreeName}`);
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
    project.overridePath(worktree.path);

    const events = project.events || {};
    hasClaudeEvent = !!events.claude;
    hasNpmEvent = !!events.npm;
  }

  const shouldAttach = options.attach !== false; // Default to true

  if (isShellMode) {
    const shellCommands = await buildWorktreeShellCommands(
      project,
      worktree.path,
      sessionName,
      { hasClaudeEvent, hasNpmEvent },
      options.recreate === true
    );
    console.log(shellCommands.join('\n'));
  } else {
    if (await tmux.isTmuxAvailable()) {
      try {
        const reused = await createWorktreeTmuxSession(
          project,
          worktree.path,
          sessionName,
          tmux,
          { hasClaudeEvent, hasNpmEvent },
          options.recreate === true
        );

        if (shouldAttach) {
          await tmux.attachToSession(sessionName);
          console.log(
            chalk.green(
              reused
                ? `Attached to existing tmux session '${sessionName}' (use --recreate to rebuild it)`
                : `Opened worktree '${worktreeName}' in tmux session '${sessionName}'`
            )
          );
        } else {
          // Session created but not attached - return session info for caller to handle
          console.log(
            chalk.green(`\nCreated tmux session '${sessionName}' for worktree '${worktreeName}'`)
          );
          console.log(`\nTo attach to this session, run:`);
          console.log(chalk.cyan(`  tmux attach -t '${sessionTarget(sessionName)}'`));
        }
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
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean },
  recreate: boolean
): Promise<string[]> {
  const { hasClaudeEvent, hasNpmEvent } = eventFlags;

  // Get claude args if claude is enabled and project exists
  const claudeArgs = hasClaudeEvent && project ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent && project ? await getNpmCommand(project) : '';

  // Build tmux commands using a custom session name
  let create: string[];
  if (hasClaudeEvent && hasNpmEvent && project) {
    create = buildThreePaneCommands(sessionName, worktreePath, claudeArgs, npmCommand);
  } else if (hasClaudeEvent && project) {
    create = buildSplitClaudeCommands(sessionName, worktreePath, claudeArgs);
  } else if (hasNpmEvent && project) {
    create = buildTwoPaneNpmCommands(sessionName, worktreePath, npmCommand);
  } else {
    // Just open a shell in the worktree
    create = buildSimpleSessionCommands(sessionName, worktreePath);
  }

  const target = sessionTarget(sessionName);
  const commands = [`# workon worktree session: ${sessionName}`];

  if (recreate) {
    commands.push(
      `if tmux has-session -t '${target}' 2>/dev/null; then`,
      `  tmux kill-session -t '${target}'`,
      `fi`
    );
  }

  // Reuse a live session rather than tearing it down - it may have an editor or
  // a long-running agent in it that the user did not ask to lose.
  commands.push(`if ! tmux has-session -t '${target}' 2>/dev/null; then`);
  commands.push(...create.map((cmd) => `  ${cmd}`));
  commands.push(`fi`);
  commands.push(getAttachCommand(sessionName));

  return commands;
}

/**
 * Create the tmux session for a worktree.
 * Returns true when an existing session was reused instead of rebuilt.
 */
async function createWorktreeTmuxSession(
  project: Project | null,
  worktreePath: string,
  sessionName: string,
  tmux: TmuxManager,
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean },
  recreate: boolean
): Promise<boolean> {
  const { hasClaudeEvent, hasNpmEvent } = eventFlags;

  const exists = await tmux.sessionExists(sessionName);
  if (exists) {
    if (!recreate) {
      // Reuse it: rebuilding would kill whatever is running in there.
      return true;
    }
    await tmux.killSession(sessionName);
  }

  // Get claude args if claude is enabled and project exists
  const claudeArgs = hasClaudeEvent && project ? getClaudeArgs(project) : [];
  const npmCommand = hasNpmEvent && project ? await getNpmCommand(project) : '';

  try {
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
  } catch (error) {
    // Don't leave a half-built session behind for the next run to reuse.
    await tmux.killSession(sessionName);
    throw error;
  }

  return false;
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

function buildSimpleSessionCommands(sessionName: string, path: string): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);

  return [`tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`];
}

function buildSplitClaudeCommands(
  sessionName: string,
  path: string,
  claudeArgs: string[]
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));

  return [
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
    `tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}'`,
    `tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`,
  ];
}

function buildTwoPaneNpmCommands(sessionName: string, path: string, npmCommand: string): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  return [
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`,
    `tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}' '${wrappedNpmCmd}'`,
    `tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`,
  ];
}

function buildThreePaneCommands(
  sessionName: string,
  path: string,
  claudeArgs: string[],
  npmCommand: string
): string[] {
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(path);
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));
  const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

  return [
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
    `tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}'`,
    `tmux split-window -v -t '${paneTarget(sessionName, '0.1')}' -c '${escapedPath}' '${wrappedNpmCmd}'`,
    `tmux resize-pane -t '${paneTarget(sessionName, '0.2')}' -y 10`,
    `tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`,
  ];
}

function getAttachCommand(sessionName: string): string {
  const target = sessionTarget(sessionName);

  if (process.env.TMUX) {
    return `tmux switch-client -t '${target}'`;
  }

  const isITerm =
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.LC_TERMINAL === 'iTerm2' ||
    process.env.ITERM_SESSION_ID;
  const useiTermIntegration = isITerm && !process.env.TMUX_CC_NOT_SUPPORTED;

  if (useiTermIntegration) {
    return `tmux -CC attach-session -t '${target}'`;
  }
  return `tmux attach-session -t '${target}'`;
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
  await exec(`tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}'`);
  await exec(`tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`);
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
  await exec(
    `tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}' '${wrappedNpmCmd}'`
  );
  await exec(`tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`);
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
  await exec(`tmux split-window -h -t '${paneTarget(sessionName)}' -c '${escapedPath}'`);
  await exec(
    `tmux split-window -v -t '${paneTarget(sessionName, '0.1')}' -c '${escapedPath}' '${wrappedNpmCmd}'`
  );
  await exec(`tmux resize-pane -t '${paneTarget(sessionName, '0.2')}' -y 10`);
  await exec(`tmux select-pane -t '${paneTarget(sessionName, '0.0')}'`);
}
