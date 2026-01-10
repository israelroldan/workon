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

interface OpenContext {
  config: Config;
  log: Logger;
}

interface OpenOptions {
  debug?: boolean;
  dryRun?: boolean;
  shell?: boolean;
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

      // Initialize event registry
      await EventRegistry.initialize();

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

  // Parse colon syntax: project:command1,command2
  const [projectName, commandsString] = projectParam.split(':');
  const requestedCommands = commandsString
    ? commandsString.split(',').map((cmd) => cmd.trim())
    : null;

  // Special case: project:help shows available commands
  if (commandsString === 'help') {
    await showProjectHelp(projectName, ctx);
    return;
  }

  log.debug(
    `Project: ${projectName}, Commands: ${requestedCommands ? requestedCommands.join(', ') : 'all'}`
  );

  const projects = config.getProjects();
  const environment = await EnvironmentRecognizer.recognize(File.cwd());

  // Handle "this" or "." for current project
  if (environment.$isProjectEnvironment && (projectName === 'this' || projectName === '.')) {
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
    await switchTo(projectEnv, requestedCommands, options, ctx);
  } else {
    log.debug(`Project '${projectName}' not found, starting interactive mode`);
    const { runInteractive } = await import('./interactive.js');
    await runInteractive({ config, log, environment, suggestedName: projectName });
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
  ctx: OpenContext
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
    await handleThreePaneLayout(project, isShellMode, dryRun, shellCommands, events, ctx);
  } else if (hasCwd && hasNpmEvent) {
    await handleTwoPaneNpmLayout(project, isShellMode, dryRun, shellCommands, events, ctx);
  } else if (hasCwd && hasClaudeEvent) {
    await handleSplitTerminal(project, isShellMode, dryRun, shellCommands, events, ctx);
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
  return typeof claudeConfig === 'object' && claudeConfig.flags ? claudeConfig.flags : [];
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
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;
  const tmux = new TmuxManager();
  const { isShellMode, dryRun } = options;

  let tmuxHandled = false;

  if (isShellMode) {
    if (await tmux.isTmuxAvailable()) {
      const commands = buildLayoutShellCommands(tmux, project, layout);
      shellCommands.push(...commands);
      tmuxHandled = true;
    } else {
      log.debug('Tmux not available, falling back to normal mode');
      buildFallbackCommands(shellCommands, project, layout);
      tmuxHandled = true;
    }
  } else if (!dryRun) {
    if (await tmux.isTmuxAvailable()) {
      try {
        const sessionName = await createTmuxSession(tmux, project, layout);
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
  if (!dryRun) {
    for (const event of events.filter((e) => !layout.handledEvents.includes(e))) {
      await processEvent(event, { project, isShellMode, shellCommands }, ctx);
    }
  }
}

function buildLayoutShellCommands(
  tmux: TmuxManager,
  project: Project,
  layout: LayoutConfig
): string[] {
  switch (layout.type) {
    case 'split-claude':
      return tmux.buildShellCommands(project.name, project.path.path, layout.claudeArgs);
    case 'three-pane':
      return tmux.buildThreePaneShellCommands(
        project.name,
        project.path.path,
        layout.claudeArgs,
        layout.npmCommand!
      );
    case 'two-pane-npm':
      return tmux.buildTwoPaneNpmShellCommands(project.name, project.path.path, layout.npmCommand!);
  }
}

function buildFallbackCommands(
  shellCommands: string[],
  project: Project,
  layout: LayoutConfig
): void {
  shellCommands.push(`cd "${project.path.path}"`);

  if (layout.type === 'split-claude' || layout.type === 'three-pane') {
    const claudeCommand =
      layout.claudeArgs.length > 0 ? `claude ${layout.claudeArgs.join(' ')}` : 'claude';
    shellCommands.push(claudeCommand);
  }

  if (layout.npmCommand) {
    shellCommands.push(layout.npmCommand);
  }
}

async function createTmuxSession(
  tmux: TmuxManager,
  project: Project,
  layout: LayoutConfig
): Promise<string> {
  switch (layout.type) {
    case 'split-claude':
      return tmux.createSplitSession(project.name, project.path.path, layout.claudeArgs);
    case 'three-pane':
      return tmux.createThreePaneSession(
        project.name,
        project.path.path,
        layout.claudeArgs,
        layout.npmCommand!
      );
    case 'two-pane-npm':
      return tmux.createTwoPaneNpmSession(project.name, project.path.path, layout.npmCommand!);
  }
}

async function handleSplitTerminal(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const layout: LayoutConfig = {
    type: 'split-claude',
    handledEvents: ['cwd', 'claude'],
    dryRunMessage: `Would create split tmux session '${project.name}' with Claude`,
    claudeArgs: getClaudeArgs(project),
    npmCommand: null,
  };
  await handleTmuxLayout(project, layout, { isShellMode, dryRun }, shellCommands, events, ctx);
}

async function handleThreePaneLayout(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const layout: LayoutConfig = {
    type: 'three-pane',
    handledEvents: ['cwd', 'claude', 'npm'],
    dryRunMessage: `Would create three-pane tmux session '${project.name}' with Claude and NPM`,
    claudeArgs: getClaudeArgs(project),
    npmCommand: await getNpmCommand(project),
  };
  await handleTmuxLayout(project, layout, { isShellMode, dryRun }, shellCommands, events, ctx);
}

async function handleTwoPaneNpmLayout(
  project: Project,
  isShellMode: boolean,
  dryRun: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const layout: LayoutConfig = {
    type: 'two-pane-npm',
    handledEvents: ['cwd', 'npm'],
    dryRunMessage: `Would create two-pane tmux session '${project.name}' with NPM`,
    claudeArgs: [],
    npmCommand: await getNpmCommand(project),
  };
  await handleTmuxLayout(project, layout, { isShellMode, dryRun }, shellCommands, events, ctx);
}

async function processEvent(
  event: string,
  context: EventProcessingContext,
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;

  log.debug(`Processing event ${event}`);

  const eventHandler = EventRegistry.getEventByName(event);
  if (eventHandler) {
    await eventHandler.processing.processEvent(context);
  } else {
    log.debug(`No event handler found for: ${event}`);
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

  console.log(`  workon ${projectName}:cwd --shell       # Output shell commands\n`);
}
