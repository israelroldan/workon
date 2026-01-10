import { Command } from 'commander';
import { select, input, confirm, checkbox } from '@inquirer/prompts';
import File from 'phylo';
import type { Config } from '../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig } from '../types/index.js';
import { EventRegistry } from '../events/registry.js';
import { IDE_CHOICES } from '../types/constants.js';

interface ManageContext {
  config: Config;
  log: Logger;
}

export function createManageCommand(ctx: ManageContext): Command {
  const { log } = ctx;

  return new Command('manage')
    .description('Interactive project management')
    .option('-d, --debug', 'Enable debug logging')
    .action(async (options: { debug?: boolean }) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      await mainMenu(ctx);
    });
}

async function mainMenu(ctx: ManageContext): Promise<void> {
  const { config } = ctx;
  const projects = config.getProjects();
  const hasProjects = Object.keys(projects).length > 0;

  const choices = [
    { name: 'Create new project', value: 'create' },
    ...(hasProjects
      ? [
          { name: 'Edit project', value: 'edit' },
          { name: 'Delete project', value: 'delete' },
          { name: 'List projects', value: 'list' },
        ]
      : []),
    { name: 'Exit', value: 'exit' },
  ];

  const action = await select({
    message: 'What would you like to do?',
    choices,
  });

  switch (action) {
    case 'create':
      await createProject(ctx);
      break;
    case 'edit':
      await editProject(ctx);
      break;
    case 'delete':
      await deleteProject(ctx);
      break;
    case 'list':
      await listProjects(ctx);
      break;
    case 'exit':
      return;
  }

  // Return to main menu
  await mainMenu(ctx);
}

async function createProject(ctx: ManageContext): Promise<void> {
  const { config, log } = ctx;
  const defaults = config.getDefaults();
  const projects = config.getProjects();

  // Project name
  const name = await input({
    message: 'Project name:',
    validate: (value) => {
      if (!value.trim()) return 'Name is required';
      if (!/^[\w-]+$/.test(value))
        return 'Name can only contain letters, numbers, underscores, and hyphens';
      if (value in projects) return 'Project already exists';
      return true;
    },
  });

  // Project path
  const defaultPath = defaults?.base ? File.from(defaults.base).join(name).path : name;
  const pathInput = await input({
    message: 'Project path:',
    default: defaultPath,
    validate: (value) => {
      const path = File.from(value);
      try {
        const exists = path.exists();
        if (!exists) return `Path does not exist: ${value}`;
        const stat = path.stat();
        if (!stat.isDirectory()) return 'Path must be a directory';
        return true;
      } catch {
        return `Invalid path: ${value}`;
      }
    },
  });

  // Convert to relative path if possible
  let relativePath = pathInput;
  if (defaults?.base) {
    const baseDir = File.from(defaults.base);
    const pathFile = File.from(pathInput);
    try {
      relativePath = pathFile.relativize(baseDir.path).path;
    } catch {
      relativePath = pathInput;
    }
  }

  // IDE selection
  const ide = await select({
    message: 'Select IDE:',
    choices: IDE_CHOICES,
  });

  // Homepage (optional)
  const homepage = await input({
    message: 'Project homepage URL (optional):',
    default: '',
  });

  // Event selection
  const availableEvents = EventRegistry.getEventsForManageUI();
  const selectedEvents = await checkbox({
    message: 'Select events to enable:',
    choices: availableEvents.map((e) => ({
      name: `${e.name} - ${e.description}`,
      value: e.value,
      checked: e.value === 'cwd' || e.value === 'ide',
    })),
  });

  // Configure each selected event
  const events: EventsConfig = {};
  for (const eventName of selectedEvents) {
    const eventHandler = EventRegistry.getEventByName(eventName);
    if (eventHandler) {
      const eventConfig = await eventHandler.configuration.configureInteractive();
      events[eventName as keyof EventsConfig] = eventConfig as EventsConfig[keyof EventsConfig];
    }
  }

  // Build project config
  const projectConfig: ProjectConfig = {
    path: relativePath,
    ide,
    events,
  };

  if (homepage.trim()) {
    projectConfig.homepage = homepage.trim();
  }

  // Confirm
  console.log('\nProject configuration:');
  console.log(JSON.stringify(projectConfig, null, 2));

  const confirmed = await confirm({
    message: 'Save this project?',
    default: true,
  });

  if (confirmed) {
    config.setProject(name, projectConfig);
    log.info(`Project '${name}' created successfully!`);
    log.info(`Use 'workon ${name}' to start working!`);
  } else {
    log.info('Project creation cancelled.');
  }
}

async function editProject(ctx: ManageContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();
  const projectNames = Object.keys(projects);

  if (projectNames.length === 0) {
    log.info('No projects to edit.');
    return;
  }

  const name = await select({
    message: 'Select project to edit:',
    choices: projectNames.map((n) => ({ name: n, value: n })),
  });

  const project = projects[name];
  const defaults = config.getDefaults();

  // Path
  const pathInput = await input({
    message: 'Project path:',
    default: project.path,
  });

  let relativePath = pathInput;
  if (defaults?.base) {
    const baseDir = File.from(defaults.base);
    const pathFile = File.from(pathInput);
    try {
      if (pathFile.isAbsolute()) {
        relativePath = pathFile.relativize(baseDir.path).path;
      }
    } catch {
      relativePath = pathInput;
    }
  }

  // IDE
  const ide = await select({
    message: 'Select IDE:',
    choices: IDE_CHOICES,
    default: project.ide || 'vscode',
  });

  // Homepage
  const homepage = await input({
    message: 'Project homepage URL:',
    default: project.homepage || '',
  });

  // Keep existing events or reconfigure?
  const keepEvents = await confirm({
    message: 'Keep existing event configuration?',
    default: true,
  });

  let events = project.events;
  if (!keepEvents) {
    const availableEvents = EventRegistry.getEventsForManageUI();
    const currentEvents = Object.keys(project.events);

    const selectedEvents = await checkbox({
      message: 'Select events to enable:',
      choices: availableEvents.map((e) => ({
        name: `${e.name} - ${e.description}`,
        value: e.value,
        checked: currentEvents.includes(e.value),
      })),
    });

    events = {};
    for (const eventName of selectedEvents) {
      // Keep existing config if event was previously configured
      if (project.events[eventName]) {
        (events as Record<string, unknown>)[eventName] = project.events[eventName];
      } else {
        const eventHandler = EventRegistry.getEventByName(eventName);
        if (eventHandler) {
          const eventConfig = await eventHandler.configuration.configureInteractive();
          events[eventName as keyof EventsConfig] = eventConfig as EventsConfig[keyof EventsConfig];
        }
      }
    }
  }

  // Build updated config
  const updatedConfig: ProjectConfig = {
    path: relativePath,
    ide,
    events,
  };

  if (homepage.trim()) {
    updatedConfig.homepage = homepage.trim();
  }

  // Confirm
  console.log('\nUpdated configuration:');
  console.log(JSON.stringify(updatedConfig, null, 2));

  const confirmed = await confirm({
    message: 'Save changes?',
    default: true,
  });

  if (confirmed) {
    config.setProject(name, updatedConfig);
    log.info(`Project '${name}' updated successfully!`);
  } else {
    log.info('Edit cancelled.');
  }
}

async function deleteProject(ctx: ManageContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();
  const projectNames = Object.keys(projects);

  if (projectNames.length === 0) {
    log.info('No projects to delete.');
    return;
  }

  const name = await select({
    message: 'Select project to delete:',
    choices: projectNames.map((n) => ({ name: n, value: n })),
  });

  const confirmed = await confirm({
    message: `Are you sure you want to delete '${name}'?`,
    default: false,
  });

  if (confirmed) {
    config.deleteProject(name);
    log.info(`Project '${name}' deleted.`);
  } else {
    log.info('Delete cancelled.');
  }
}

async function listProjects(ctx: ManageContext): Promise<void> {
  const { config } = ctx;
  const projects = config.getProjects();
  const defaults = config.getDefaults();

  console.log('\nConfigured projects:\n');

  for (const [name, project] of Object.entries(projects)) {
    const fullPath = defaults?.base
      ? File.from(defaults.base).join(project.path).path
      : project.path;

    console.log(`  ${name}`);
    console.log(`    Path: ${fullPath}`);
    console.log(`    IDE: ${project.ide || 'not set'}`);
    console.log(`    Events: ${Object.keys(project.events).join(', ') || 'none'}`);
    if (project.homepage) {
      console.log(`    Homepage: ${project.homepage}`);
    }
    console.log();
  }
}
