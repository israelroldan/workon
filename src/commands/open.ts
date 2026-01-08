import { Command } from 'commander';
import File from 'phylo';
import type { Config } from '../lib/config.js';
import type { Logger, ClaudeConfig, NpmConfig } from '../types/index.js';
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

  if (hasCwd && hasClaudeEvent && hasNpmEvent) {
    await handleThreePaneLayout(project, isShellMode, shellCommands, events, ctx);
  } else if (hasCwd && hasNpmEvent) {
    await handleTwoPaneNpmLayout(project, isShellMode, shellCommands, events, ctx);
  } else if (hasCwd && hasClaudeEvent) {
    await handleSplitTerminal(project, isShellMode, shellCommands, events, ctx);
  } else {
    // Normal event processing
    for (const event of events) {
      if (!options.dryRun) {
        await processEvent(event, { project, isShellMode, shellCommands }, ctx);
      }
    }
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

async function handleSplitTerminal(
  project: { name: string; path: { path: string }; events: Record<string, unknown> },
  isShellMode: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;
  const tmux = new TmuxManager();
  const claudeConfig = project.events.claude as ClaudeConfig | boolean;
  const claudeArgs =
    typeof claudeConfig === 'object' && claudeConfig.flags ? claudeConfig.flags : [];

  if (isShellMode) {
    if (await tmux.isTmuxAvailable()) {
      const commands = tmux.buildShellCommands(project.name, project.path.path, claudeArgs);
      shellCommands.push(...commands);
    } else {
      log.debug('Tmux not available, falling back to normal mode');
      shellCommands.push(`cd "${project.path.path}"`);
      const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
      shellCommands.push(claudeCommand);
    }
  } else {
    if (await tmux.isTmuxAvailable()) {
      try {
        const sessionName = await tmux.createSplitSession(
          project.name,
          project.path.path,
          claudeArgs
        );
        await tmux.attachToSession(sessionName);
      } catch (error) {
        log.debug(`Failed to create tmux session: ${(error as Error).message}`);
        for (const event of events.filter((e) => !['cwd', 'claude'].includes(e))) {
          await processEvent(event, { project: project as any, isShellMode, shellCommands }, ctx);
        }
      }
    }
  }

  // Process other events
  for (const event of events.filter((e) => !['cwd', 'claude'].includes(e))) {
    await processEvent(event, { project: project as any, isShellMode, shellCommands }, ctx);
  }
}

async function handleThreePaneLayout(
  project: { name: string; path: { path: string }; events: Record<string, unknown> },
  isShellMode: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;
  const tmux = new TmuxManager();
  const claudeConfig = project.events.claude as ClaudeConfig | boolean;
  const claudeArgs =
    typeof claudeConfig === 'object' && claudeConfig.flags ? claudeConfig.flags : [];
  const npmConfig = project.events.npm as NpmConfig | string | boolean;
  const { NpmEvent } = await import('../events/extensions/npm.js');
  const npmCommand = NpmEvent.getNpmCommand(npmConfig);

  if (isShellMode) {
    if (await tmux.isTmuxAvailable()) {
      const commands = tmux.buildThreePaneShellCommands(
        project.name,
        project.path.path,
        claudeArgs,
        npmCommand
      );
      shellCommands.push(...commands);
    } else {
      log.debug('Tmux not available, falling back to normal mode');
      shellCommands.push(`cd "${project.path.path}"`);
      shellCommands.push(claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude');
      shellCommands.push(npmCommand);
    }
  } else {
    if (await tmux.isTmuxAvailable()) {
      try {
        const sessionName = await tmux.createThreePaneSession(
          project.name,
          project.path.path,
          claudeArgs,
          npmCommand
        );
        await tmux.attachToSession(sessionName);
      } catch (error) {
        log.debug(`Failed to create tmux session: ${(error as Error).message}`);
      }
    }
  }

  // Process other events
  for (const event of events.filter((e) => !['cwd', 'claude', 'npm'].includes(e))) {
    await processEvent(event, { project: project as any, isShellMode, shellCommands }, ctx);
  }
}

async function handleTwoPaneNpmLayout(
  project: { name: string; path: { path: string }; events: Record<string, unknown> },
  isShellMode: boolean,
  shellCommands: string[],
  events: string[],
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;
  const tmux = new TmuxManager();
  const npmConfig = project.events.npm as NpmConfig | string | boolean;
  const { NpmEvent } = await import('../events/extensions/npm.js');
  const npmCommand = NpmEvent.getNpmCommand(npmConfig);

  if (isShellMode) {
    if (await tmux.isTmuxAvailable()) {
      const commands = tmux.buildTwoPaneNpmShellCommands(
        project.name,
        project.path.path,
        npmCommand
      );
      shellCommands.push(...commands);
    } else {
      log.debug('Tmux not available, falling back to normal mode');
      shellCommands.push(`cd "${project.path.path}"`);
      shellCommands.push(npmCommand);
    }
  } else {
    if (await tmux.isTmuxAvailable()) {
      try {
        const sessionName = await tmux.createTwoPaneNpmSession(
          project.name,
          project.path.path,
          npmCommand
        );
        await tmux.attachToSession(sessionName);
      } catch (error) {
        log.debug(`Failed to create tmux session: ${(error as Error).message}`);
      }
    }
  }

  // Process other events
  for (const event of events.filter((e) => !['cwd', 'npm'].includes(e))) {
    await processEvent(event, { project: project as any, isShellMode, shellCommands }, ctx);
  }
}

async function processEvent(
  event: string,
  context: { project: any; isShellMode: boolean; shellCommands: string[] },
  ctx: OpenContext
): Promise<void> {
  const { log } = ctx;

  log.debug(`Processing event ${event}`);

  const eventHandler = EventRegistry.getEventByName(event);
  if (eventHandler && (eventHandler as any).processing) {
    await (eventHandler as any).processing.processEvent(context);
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
      const metadata = (eventHandler as any).metadata;
      const config = projectConfig.events[eventName as keyof typeof projectConfig.events];
      let configDesc = '';
      if (config !== true && config !== 'true') {
        if (typeof config === 'object') {
          configDesc = ` (${JSON.stringify(config)})`;
        } else {
          configDesc = ` (${config})`;
        }
      }
      console.log(`  ${eventName.padEnd(8)} - ${metadata.description}${configDesc}`);
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
