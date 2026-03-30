import { Command } from 'commander';
import File from 'phylo';
import type { Config } from '../lib/config.js';
import type {
  Logger,
  ClaudeConfig,
  NpmConfig,
  Project,
  EventProcessingContext,
} from '../types/index.js';
import { EnvironmentRecognizer, ProjectEnvironment } from '../lib/environment.js';
import { TmuxManager } from '../lib/tmux.js';
import { EventRegistry } from '../events/registry.js';
import { WorktreeManager } from '../lib/worktree.js';

interface OpenContext {
  config: Config;
  log: Logger;
}

interface OpenOptions {
  debug?: boolean;
  dryRun?: boolean;
  shell?: boolean;
}

/**
 * Run the open command logic directly (used when delegating from main CLI)
 */
export async function runOpen(
  projectArg: string,
  options: OpenOptions,
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;

  if (options.debug) {
    log.setLogLevel('debug');
  }

  await processProject(projectArg, options, ctx);
}

export function createOpenCommand(ctx: OpenContext): Command {
  const { config, log } = ctx;

  const command = new Command('open')
    .description('Open a project by passing its project id')
    .argument('[project]', 'The id of the project to open (supports project:command syntax)')
    .option('-d, --debug', 'Enable debug logging')
    .option('-n, --dry-run', 'Show what would happen without executing')
    .option('--shell', 'Output shell commands instead of spawning processes')
    .action(async (projectArg: string | undefined, options: OpenOptions) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      if (projectArg) {
        await processProject(projectArg, options, ctx);
      } else {
        log.debug('No project name provided, starting interactive mode');
        const { runInteractive } = await import('./interactive.js');
        const environment = await EnvironmentRecognizer.recognize(File.cwd());
        await runInteractive({ config, log, environment });
      }
    });

  return command;
}

async function processProject(
  projectParam: string,
  options: OpenOptions,
  ctx: OpenContext
): Promise<void> {
  const { config, log } = ctx;

  // Parse colon syntax: project:command1,command2 or project:command1,command2:worktree
  const parts = projectParam.split(':');
  const projectName = parts[0];
  const commandsString = parts[1] || null;
  const worktreeName = parts[2] || null;

  const requestedCommands =
    commandsString && commandsString !== 'help'
      ? commandsString.split(',').map((cmd) => cmd.trim())
      : null;

  // Special case: project:help shows available commands
  if (commandsString === 'help') {
    await showProjectHelp(projectName, ctx);
    return;
  }

  log.debug(
    `Project: ${projectName}, Commands: ${requestedCommands ? requestedCommands.join(', ') : 'all'}` +
      (worktreeName ? `, Worktree: ${worktreeName}` : '')
  );

  const projects = config.getProjects();
  const environment = await EnvironmentRecognizer.recognize(File.cwd());

  // Handle "this" or "." for current project
  if (environment.$isProjectEnvironment && (projectName === 'this' || projectName === '.')) {
    if (worktreeName) {
      log.error(
        `Worktree syntax is not supported with '${projectName}'. Use the full project name instead:`
      );
      log.info(`  workon ${environment.project.name}::${worktreeName}`);
      process.exit(1);
    }
    log.info(`Opening current project: ${environment.project.name}`);
    await switchTo(environment, requestedCommands, options, ctx);
    return;
  }

  if (projectName in projects) {
    const cfg = projects[projectName];
    const projectCfg = { ...cfg, name: projectName };

    // Validate requested commands if specified
    if (requestedCommands) {
      validateRequestedCommands(requestedCommands, projectCfg, projectName);
    }

    const projectEnv = ProjectEnvironment.load(projectCfg, config.getDefaults());

    // If a worktree was specified, override the project path to the worktree path
    if (worktreeName) {
      const projectPath = projectEnv.project.path.path;
      const manager = new WorktreeManager(projectPath, projectName);
      const worktree = await manager.get(worktreeName);

      if (!worktree) {
        log.error(`Worktree '${worktreeName}' not found for project '${projectName}'.`);
        const worktrees = await manager.listManagedWorktrees();
        if (worktrees.length > 0) {
          log.info('Available worktrees:');
          worktrees.forEach((wt) => log.info(`  - ${wt.name}`));
        }
        process.exit(1);
      }

      log.debug(`Using worktree path: ${worktree.path}`);
      projectEnv.project.overridePath(worktree.path);
    }

    await switchTo(projectEnv, requestedCommands, options, ctx, worktreeName);
  } else {
    log.error(`Project '${projectName}' not found.`);
    log.info(`Run 'workon' without arguments to see available projects or create a new one.`);
    process.exit(1);
  }
}

function validateRequestedCommands(
  requestedCommands: string[],
  projectConfig: { events?: Record<string, unknown> },
  projectName: string
): void {
  const configuredEvents = Object.keys(projectConfig.events || {});
  const invalidCommands = requestedCommands.filter((cmd) => !configuredEvents.includes(cmd));

  if (invalidCommands.length > 0) {
    const availableCommands = configuredEvents.join(', ');
    throw new Error(
      `Commands not configured for project '${projectName}': ${invalidCommands.join(', ')}\n` +
        `Available commands: ${availableCommands}`
    );
  }
}

async function switchTo(
  environment: ProjectEnvironment,
  requestedCommands: string[] | null,
  options: OpenOptions,
  ctx: OpenContext,
  worktreeName?: string | null
): Promise<void> {
  const { log } = ctx;
  const project = environment.project;

  // Determine which events to execute
  let events: string[];
  if (requestedCommands) {
    events = resolveCommandDependencies(requestedCommands, project);
    log.debug(`Executing requested commands: ${events.join(', ')}`);
  } else {
    events = Object.keys(project.events).filter(
      (e) => project.events[e as keyof typeof project.events]
    );
    log.debug(`Executing all configured commands: ${events.join(', ')}`);
  }

  log.debug(`Shell is ${process.env.SHELL}`);
  log.debug(`Project path is ${project.path.path}`);
  log.debug(`IDE command is: ${project.ide}`);
  log.debug(`Final events to execute: ${events.join(', ')}`);

  const shellCommands: string[] = [];
  const isShellMode = options.shell || false;

  // Intelligent layout detection
  const hasCwd = events.includes('cwd');
  const hasClaudeEvent = events.includes('claude');
  const hasNpmEvent = events.includes('npm');

  const dryRun = options.dryRun || false;

  if (hasCwd && hasClaudeEvent && hasNpmEvent) {
    await handleThreePaneLayout(
      project,
      isShellMode,
      dryRun,
      shellCommands,
      events,
      ctx,
      worktreeName
    );
  } else if (hasCwd && hasNpmEvent) {
    await handleTwoPaneNpmLayout(
      project,
      isShellMode,
      dryRun,
      shellCommands,
      events,
      ctx,
      worktreeName
    );
  } else if (hasCwd && hasClaudeEvent) {
    await handleSplitTerminal(
      project,
      isShellMode,
      dryRun,
      shellCommands,
      events,
      ctx,
      worktreeName
    );
  } else {
    // Normal event processing
    for (const event of events) {
      if (!dryRun) {
        await processEvent(event, { project, isShellMode, shellCommands }, ctx);
      }
    }
  }

  // In dry-run mode, show what would be executed
  if (dryRun) {
    log.info('Dry run - would execute events:', events.join(', '));
  }

  // Output collected shell commands
  if (isShellMode && shellCommands.length > 0) {
    console.log(shellCommands.join('\n'));
  }
}

function resolveCommandDependencies(
  requestedCommands: string[],
  project: { events: Record<string, unknown> }
): string[] {
  const resolved = [...requestedCommands];

  // Auto-add cwd dependency for commands that need it
  const needsCwd = ['claude', 'npm', 'ide'];
  const needsCwdCommands = requestedCommands.filter((cmd) => needsCwd.includes(cmd));

  if (needsCwdCommands.length > 0 && !requestedCommands.includes('cwd') && project.events.cwd) {
    resolved.unshift('cwd');
  }

  return [...new Set(resolved)];
}

// Layout types for tmux session configurations
type LayoutType = 'split-claude' | 'three-pane' | 'two-pane-npm';

interface LayoutConfig {
  type: LayoutType;
  handledEvents: string[];
  dryRunMessage: string;
  claudeArgs: string[];
  npmCommand: string | null;
}

function getClaudeArgs(project: Project): string[] {
  const claudeConfig = project.events.claude as ClaudeConfig | boolean;
  const userFlags =
    typeof claudeConfig === 'object' && claudeConfig.flags ? claudeConfig.flags : [];
  // Always include --dangerously-skip-permissions for automated tmux sessions
  return ['--dangerously-skip-permissions', ...userFlags];
}

async function getNpmCommand(project: Project): Promise<string> {
  const npmConfig = project.events.npm as NpmConfig | string | boolean;
  const { NpmEvent } = await import('../events/extensions/npm.js');
  return NpmEvent.getNpmCommand(npmConfig);
}

async function handleTmuxLayout(
  project: Project,
  layout: LayoutConfig,
  options: { isShellMode: boolean; dryRun: boolean },
  shellCommands: string[],
  events: string[],
  ctx: OpenContext,
  worktreeName?: string | null
): Promise<void> {
  const { log } = ctx;
  const tmux = new TmuxManager();
  const { isShellMode, dryRun } = options;

  // When a worktree is specified, use a worktree-specific tmux session name
  // so it doesn't collide with the main project's session
  const tmuxSessionId = worktreeName ? `${project.name}-${worktreeName}` : project.name;

  let tmuxHandled = false;

  if (isShellMode) {
    if (await tmux.isTmuxAvailable()) {
      // Process remaining events (like IDE) FIRST, before any tmux commands
      // This prevents backgrounded commands from interfering with tmux -CC control mode
      const remainingEvents = events.filter((e) => !layout.handledEvents.includes(e));
      for (const event of remainingEvents) {
        const eventHandler = EventRegistry.getEventByName(event);
        if (eventHandler) {
          const cmds = eventHandler.processing.generateShellCommand({
            project,
            isShellMode: true,
            shellCommands: [],
          });
          shellCommands.push(...cmds);
        }
      }

      // Now add all tmux commands (create session, split panes, attach)
      const commands = buildLayoutShellCommands(tmux, tmuxSessionId, project, layout);
      shellCommands.push(...commands);
      tmuxHandled = true;
    } else {
      log.debug('Tmux not available, falling back to normal mode');
      // Process remaining non-blocking events (like IDE) BEFORE npm in fallback mode
      // This ensures IDE opens before npm blocks
      const remainingEvents = events.filter((e) => !layout.handledEvents.includes(e));
      buildFallbackCommandsWithEvents(shellCommands, project, layout, remainingEvents, ctx);
      tmuxHandled = true;
    }
  } else if (!dryRun) {
    if (await tmux.isTmuxAvailable()) {
      try {
        const sessionName = await createTmuxSession(tmux, tmuxSessionId, project, layout);
        await tmux.attachToSession(sessionName);
        tmuxHandled = true;
      } catch (error) {
        log.debug(`Failed to create tmux session: ${(error as Error).message}`);
      }
    } else {
      log.debug('Tmux not available, falling back to normal event processing');
    }
  } else {
    log.info(layout.dryRunMessage);
    tmuxHandled = true;
  }

  // If tmux didn't handle layout events, process them normally
  if (!tmuxHandled && !dryRun) {
    for (const event of events.filter((e) => layout.handledEvents.includes(e))) {
      await processEvent(event, { project, isShellMode, shellCommands }, ctx);
    }
  }

  // Process other events not handled by the layout
  // Skip in shell mode (events already handled inline above)
  if (!dryRun && !isShellMode) {
    for (const event of events.filter((e) => !layout.handledEvents.includes(e))) {
      await processEvent(event, { project, isShellMode, shellCommands }, ctx);
    }
  }
}

function buildLayoutShellCommands(
  tmux: TmuxManager,
  sessionId: string,
  project: Project,
  layout: LayoutConfig
): string[] {
  switch (layout.type) {
    case 'split-claude':
      return tmux.buildShellCommands(sessionId, project.path.path, layout.claudeArgs);
    case 'three-pane':
      return tmux.buildThreePaneShellCommands(
        sessionId,
        project.path.path,
        layout.claudeArgs,
        layout.npmCommand!
      );
    case 'two-pane-npm':
      return tmux.buildTwoPaneNpmShellCommands(sessionId, project.path.path, layout.npmCommand!);
  }
}

function buildFallbackCommandsWithEvents(
  shellCommands: string[],
  project: Project,
  layout: LayoutConfig,
  remainingEvents: string[],
  _ctx: OpenContext
): void {
  // Warn user that tmux is not available
  shellCommands.push(`echo "⚠ tmux not available - install with: brew install tmux" >&2`);

  // Use pushd so user can popd to go back
  shellCommands.push(`pushd "${project.path.path}" > /dev/null`);

  // Add non-blocking remaining events (like IDE)
  for (const event of remainingEvents) {
    const eventHandler = EventRegistry.getEventByName(event);
    if (eventHandler) {
      const cmds = eventHandler.processing.generateShellCommand({
        project,
        isShellMode: true,
        shellCommands: [],
      });
      shellCommands.push(...cmds);
    }
  }

  // Skip blocking commands (npm, claude) - they require tmux for proper UX
}

async function createTmuxSession(
  tmux: TmuxManager,
  sessionId: string,
  project: Project,
  layout: LayoutConfig
): Promise<string> {
  switch (layout.type) {
    case 'split-claude':
      return tmux.createSplitSession(sessionId, project.path.path, layout.claudeArgs);
    case 'three-pane':
      return tmux.createThreePaneSession(
        sessionId,
        project.path.path,
        layout.claudeArgs,
        layout.npmCommand!
      );
    case 'two-pane-npm':
      return tmux.createTwoPaneNpmSession(sessionId, project.path.path, layout.npmCommand!);
  }
}

async function handleSplitTerminal(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext,
  worktreeName?: string | null
): Promise<void> {
  const sessionLabel = worktreeName ? `${project.name}::${worktreeName}` : project.name;
  const layout: LayoutConfig = {
    type: 'split-claude',
    handledEvents: ['cwd', 'claude'],
    dryRunMessage: `Would create split tmux session '${sessionLabel}' with Claude`,
    claudeArgs: getClaudeArgs(project),
    npmCommand: null,
  };
  await handleTmuxLayout(
    project,
    layout,
    { isShellMode, dryRun },
    shellCommands,
    events,
    ctx,
    worktreeName
  );
}

async function handleThreePaneLayout(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext,
  worktreeName?: string | null
): Promise<void> {
  const sessionLabel = worktreeName ? `${project.name}::${worktreeName}` : project.name;
  const layout: LayoutConfig = {
    type: 'three-pane',
    handledEvents: ['cwd', 'claude', 'npm'],
    dryRunMessage: `Would create three-pane tmux session '${sessionLabel}' with Claude and NPM`,
    claudeArgs: getClaudeArgs(project),
    npmCommand: await getNpmCommand(project),
  };
  await handleTmuxLayout(
    project,
    layout,
    { isShellMode, dryRun },
    shellCommands,
    events,
    ctx,
    worktreeName
  );
}

async function handleTwoPaneNpmLayout(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext,
  worktreeName?: string | null
): Promise<void> {
  const sessionLabel = worktreeName ? `${project.name}::${worktreeName}` : project.name;
  const layout: LayoutConfig = {
    type: 'two-pane-npm',
    handledEvents: ['cwd', 'npm'],
    dryRunMessage: `Would create two-pane tmux session '${sessionLabel}' with NPM`,
    claudeArgs: [],
    npmCommand: await getNpmCommand(project),
  };
  await handleTmuxLayout(
    project,
    layout,
    { isShellMode, dryRun },
    shellCommands,
    events,
    ctx,
    worktreeName
  );
}

async function processEvent(
  event: string,
  context: EventProcessingContext,
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;

  log.debug(`Processing event ${event}`);

  const eventHandler = EventRegistry.getEventByName(event);
  if (!eventHandler) {
    log.debug(`No event handler found for: ${event}`);
    return;
  }

  try {
    await eventHandler.processing.processEvent(context);
  } catch (error) {
    log.error(`Failed to process event '${event}': ${(error as Error).message}`);
    log.debug(`Event error stack: ${(error as Error).stack}`);
    // Continue processing other events rather than stopping completely
  }
}

async function showProjectHelp(projectName: string, ctx: OpenContext): Promise<void> {
  const { config } = ctx;
  const projects = config.getProjects();

  if (!(projectName in projects)) {
    console.error(`Project '${projectName}' not found`);
    return;
  }

  const projectConfig = projects[projectName];
  const configuredEvents = Object.keys(projectConfig.events || {});

  console.log(`\nAvailable commands for '${projectName}':`);
  console.log('-'.repeat(50));

  for (const eventName of configuredEvents) {
    const eventHandler = EventRegistry.getEventByName(eventName);
    if (eventHandler) {
      const eventConfig = projectConfig.events[eventName as keyof typeof projectConfig.events];
      let configDesc = '';
      if (eventConfig !== true && eventConfig !== 'true') {
        if (typeof eventConfig === 'object') {
          configDesc = ` (${JSON.stringify(eventConfig)})`;
        } else {
          configDesc = ` (${eventConfig})`;
        }
      }
      console.log(`  ${eventName.padEnd(8)} - ${eventHandler.metadata.description}${configDesc}`);
    }
  }

  console.log('\nUsage examples:');
  console.log(`  workon ${projectName}                    # Execute all commands`);
  console.log(`  workon ${projectName}:cwd               # Just change directory`);
  console.log(`  workon ${projectName}:claude            # Just Claude (auto-adds cwd)`);

  if (configuredEvents.length > 1) {
    const twoCommands = configuredEvents.slice(0, 2).join(',');
    console.log(`  workon ${projectName}:${twoCommands.padEnd(12)} # Multiple commands`);
  }

  console.log(`  workon ${projectName}:cwd --shell       # Output shell commands`);
  console.log(`  workon ${projectName}:cwd:my-worktree   # Run in a worktree`);
  console.log(`  workon ${projectName}::my-worktree      # All commands in a worktree\n`);
}
