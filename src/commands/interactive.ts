import { select, input, checkbox, confirm } from '@inquirer/prompts';
import File from 'phylo';
import deepAssign from 'deep-assign';
import type { Config } from '../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig, IdeType } from '../types/index.js';
import type { Environment, ProjectEnvironment as ProjectEnv } from '../lib/environment.js';
import { ProjectEnvironment } from '../lib/environment.js';
import { EventRegistry } from '../events/registry.js';

interface InteractiveContext {
  config: Config;
  log: Logger;
  environment: Environment;
  suggestedName?: string;
}

const IDE_CHOICES = [
  { name: 'Visual Studio Code', value: 'vscode' as IdeType },
  { name: 'IntelliJ IDEA', value: 'idea' as IdeType },
  { name: 'Atom', value: 'atom' as IdeType },
];

export async function runInteractive(ctx: InteractiveContext): Promise<void> {
  const { config, log, environment, suggestedName } = ctx;

  showLogo(config);
  log.log('');

  const defaultName =
    suggestedName ??
    (environment.$isProjectEnvironment
      ? (environment as ProjectEnv).project.name
      : File.cwd().name);

  const fromUser = !!suggestedName;

  await startInteractive(defaultName, fromUser, ctx);
}

function showLogo(config: Config): void {
  const version = config.get<{ version: string }>('pkg')?.version ?? 'unknown';

  console.log(
    `                      8\x1b[2m${' '.repeat(Math.max(15 - version.length - 1, 1)) + 'v' + version}\x1b[22m
Yb  db  dP .d8b. 8d8b 8.dP \x1b[92m.d8b. 8d8b.\x1b[0m
 YbdPYbdP  8' .8 8P   88b  \x1b[92m8' .8 8P Y8\x1b[0m
  YP  YP   \`Y8P' 8    8 Yb \x1b[92m\`Y8P' 8   8\x1b[0m`
  );
}

async function startInteractive(
  defaultName: string,
  fromUser: boolean,
  ctx: InteractiveContext,
  showMain = false
): Promise<void> {
  const { log, environment } = ctx;

  log.debug(`Name '${defaultName}' was${fromUser ? '' : ' not'} provided by the user`);

  const question = getFirstQuestion(defaultName, fromUser, environment, showMain);
  const action = await select(question);

  switch (action) {
    case 'exit':
      return;

    case 'more':
      await startInteractive(defaultName, fromUser, ctx, true);
      return;

    case 'init-project':
      await initProject(defaultName, fromUser, ctx);
      return;

    case 'init-branch':
      await initBranch(defaultName, ctx);
      return;

    case 'switch-project':
      await switchProject(ctx);
      return;

    case 'switch-branch':
      await switchBranch(defaultName, ctx);
      return;

    case 'manage-projects':
      await manageProjects(ctx);
      return;

    case 'manage-branches':
      await manageBranches(defaultName, ctx);
      return;
  }
}

function getFirstQuestion(
  defaultName: string,
  fromUser: boolean,
  environment: Environment,
  showMain: boolean
): { message: string; choices: Array<{ name: string; value: string }> } {
  if (!showMain && environment.$isProjectEnvironment && !fromUser) {
    return {
      message: (environment as ProjectEnv).project.name,
      choices: [
        { name: 'Start a branch', value: 'init-branch' },
        { name: 'Switch branch', value: 'switch-branch' },
        { name: 'Manage branches', value: 'manage-branches' },
        { name: '---', value: '' },
        { name: 'More...', value: 'more' },
        { name: 'Exit', value: 'exit' },
      ].filter((c) => c.value !== ''),
    };
  }

  return {
    message: 'What do you want to do?',
    choices: [
      { name: 'Start a new project', value: 'init-project' },
      { name: 'Open an existing project', value: 'switch-project' },
      { name: 'Manage projects', value: 'manage-projects' },
      { name: '---', value: '' },
      { name: 'Exit', value: 'exit' },
    ].filter((c) => c.value !== ''),
  };
}

async function initProject(
  defaultName: string,
  fromUser: boolean,
  ctx: InteractiveContext
): Promise<void> {
  const { config, log } = ctx;
  const defaults = config.getDefaults();
  const projects = config.getProjects();

  // Project name
  let name: string;
  if (fromUser) {
    name = defaultName;
    log.log(`Project name: ${name}`);
  } else {
    name = await input({
      message: 'What is the name of the project?',
      default: defaultName,
      validate: (value) => {
        if (value in projects) return 'Project already exists.';
        if (/\w+#\w+/.test(value)) {
          const projectName = value.substring(0, value.indexOf('#'));
          if (!(projectName in projects)) {
            return `Project '${projectName}' does not exist. Please create it before starting a branch.`;
          }
        }
        return true;
      },
    });
  }

  // Check if this is a branch config
  const isBranch = /\w+#\w+/.test(name);
  let basePath: string;

  if (isBranch) {
    const projectName = name.substring(0, name.indexOf('#'));
    basePath = defaults?.base
      ? File.from(defaults.base).join(projects[projectName].path).absolutePath()
      : projects[projectName].path;
    log.log(`Project path: ${basePath}`);
  } else {
    // Project path
    const pathAnswer = await input({
      message: 'What is the path to the project?',
      default: defaults?.base ? File.from(defaults.base).join(name).path : name,
    });

    // Convert to relative path
    let answerFile = File.from(pathAnswer);
    const defaultBase = defaults?.base ? File.from(defaults.base) : File.cwd();

    if (!answerFile.isAbsolute()) {
      answerFile = defaultBase.join(answerFile.path);
    }

    try {
      const canonical = answerFile.canonicalize();
      if (canonical) {
        answerFile = canonical;
      } else {
        answerFile = answerFile.absolutify();
      }
    } catch {
      answerFile = answerFile.absolutify();
    }

    basePath = answerFile.relativize(defaultBase.path as unknown as string).path;
  }

  // IDE selection
  const ide = await select({
    message: 'What is the IDE?',
    choices: IDE_CHOICES,
  });

  // Event selection
  const selectedEvents = await checkbox({
    message: 'Which events should take place when opening?',
    choices: [
      { name: 'Change terminal cwd to project path', value: 'cwd', checked: true },
      { name: 'Open project in IDE', value: 'ide', checked: true },
    ],
  });

  const events: EventsConfig = {
    cwd: selectedEvents.includes('cwd'),
    ide: selectedEvents.includes('ide'),
  };

  // Save project
  const projectConfig: ProjectConfig = {
    path: basePath,
    ide,
    events,
  };

  projects[name] = projectConfig;
  config.set('projects', projects);

  log.info('Your project has been initialized.');
  log.info(`Use 'workon ${name}' to start working!`);
}

async function initBranch(defaultName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  // Branch name
  const branch = await input({
    message: 'What is the name of the branch?',
    validate: (value) => {
      if (/\w+#\w+/.test(value)) return 'Branch name can\'t contain the "#" sign';
      if (`${defaultName}#${value}` in projects) return 'Branch already exists.';
      return true;
    },
  });

  const branchName = `${defaultName}#${branch}`;
  const baseProject = projects[defaultName];

  // Create branch config by inheriting from base project (exclude name property)
  const { name: _excludedName, ...mergedConfig } = deepAssign({}, baseProject, {
    branch,
  }) as ProjectConfig;
  const branchConfig: ProjectConfig = mergedConfig;

  projects[branchName] = branchConfig;
  config.set('projects', projects);

  log.info('Your branch configuration has been initialized.');
  log.info(`Use 'workon ${branchName}' to start working!`);
}

async function switchProject(ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  // Filter to only base projects (not branch configs)
  const baseProjects = Object.keys(projects).filter((name) => !name.includes('#'));

  if (baseProjects.length === 0) {
    log.info('No projects configured yet. Use "Start a new project" to create one.');
    return;
  }

  const projectName = await select({
    message: 'Select a project to open:',
    choices: baseProjects.map((name) => ({
      name: `${name} (${projects[name].path})`,
      value: name,
    })),
  });

  await openProject(projectName, ctx);
}

async function switchBranch(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  // Find all branch configs for this project
  const branchPrefix = `${projectName}#`;
  const branches = Object.keys(projects).filter((name) => name.startsWith(branchPrefix));

  if (branches.length === 0) {
    log.info(`No branch configurations found for '${projectName}'.`);
    log.info('Use "Start a branch" to create one.');
    return;
  }

  const branchConfig = await select({
    message: 'Select a branch configuration:',
    choices: branches.map((name) => ({
      name: name.substring(branchPrefix.length),
      value: name,
    })),
  });

  await openProject(branchConfig, ctx);
}

async function manageProjects(ctx: InteractiveContext): Promise<void> {
  const { config } = ctx;

  // Initialize event registry for manage operations
  await EventRegistry.initialize();

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
    { name: 'Back', value: 'back' },
  ];

  const action = await select({
    message: 'Manage projects:',
    choices,
  });

  switch (action) {
    case 'create':
      await createProjectManage(ctx);
      break;
    case 'edit':
      await editProjectManage(ctx);
      break;
    case 'delete':
      await deleteProjectManage(ctx);
      break;
    case 'list':
      listProjectsManage(ctx);
      break;
    case 'back':
      return;
  }

  // Return to manage menu
  await manageProjects(ctx);
}

async function manageBranches(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config } = ctx;
  const projects = config.getProjects();

  // Find all branch configs for this project
  const branchPrefix = `${projectName}#`;
  const branches = Object.keys(projects).filter((name) => name.startsWith(branchPrefix));

  const choices = [
    { name: 'Create new branch config', value: 'create' },
    ...(branches.length > 0
      ? [
          { name: 'Edit branch config', value: 'edit' },
          { name: 'Delete branch config', value: 'delete' },
          { name: 'List branch configs', value: 'list' },
        ]
      : []),
    { name: 'Back', value: 'back' },
  ];

  const action = await select({
    message: `Manage branches for '${projectName}':`,
    choices,
  });

  switch (action) {
    case 'create':
      await initBranch(projectName, ctx);
      break;
    case 'edit':
      await editBranchManage(projectName, ctx);
      break;
    case 'delete':
      await deleteBranchManage(projectName, ctx);
      break;
    case 'list':
      listBranchesManage(projectName, ctx);
      break;
    case 'back':
      return;
  }

  // Return to manage branches menu
  await manageBranches(projectName, ctx);
}

async function openProject(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  if (!(projectName in projects)) {
    log.error(`Project '${projectName}' not found.`);
    return;
  }

  // Initialize event registry if needed
  await EventRegistry.initialize();

  const projectConfig = projects[projectName];
  const projectCfg = { ...projectConfig, name: projectName };
  const projectEnv = ProjectEnvironment.load(projectCfg, config.getDefaults());

  log.info(`Opening project '${projectName}'...`);

  // Execute events for the project
  const events = Object.keys(projectConfig.events).filter(
    (e) => projectConfig.events[e as keyof EventsConfig]
  );

  for (const event of events) {
    const eventHandler = EventRegistry.getEventByName(event);
    if (eventHandler) {
      await eventHandler.processing.processEvent({
        project: projectEnv.project,
        isShellMode: false,
        shellCommands: [],
      });
    }
  }
}

// Manage helper functions
async function createProjectManage(ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const defaults = config.getDefaults();
  const projects = config.getProjects();

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

  const defaultPath = defaults?.base ? File.from(defaults.base).join(name).path : name;
  const pathInput = await input({
    message: 'Project path:',
    default: defaultPath,
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

  const ide = await select({
    message: 'Select IDE:',
    choices: IDE_CHOICES,
  });

  const availableEvents = EventRegistry.getEventsForManageUI();
  const selectedEvents = await checkbox({
    message: 'Select events to enable:',
    choices: availableEvents.map((e) => ({
      name: `${e.name} - ${e.description}`,
      value: e.value,
      checked: e.value === 'cwd' || e.value === 'ide',
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

  const confirmed = await confirm({
    message: 'Save this project?',
    default: true,
  });

  if (confirmed) {
    config.setProject(name, projectConfig);
    log.info(`Project '${name}' created successfully!`);
  }
}

async function editProjectManage(ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();
  const defaults = config.getDefaults();

  // Filter to base projects only
  const baseProjects = Object.keys(projects).filter((name) => !name.includes('#'));

  if (baseProjects.length === 0) {
    log.info('No projects to edit.');
    return;
  }

  const name = await select({
    message: 'Select project to edit:',
    choices: baseProjects.map((n) => ({ name: n, value: n })),
  });

  const project = projects[name];

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

  const ide = await select({
    message: 'Select IDE:',
    choices: IDE_CHOICES,
    default: project.ide || 'vscode',
  });

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
      if (project.events[eventName as keyof EventsConfig]) {
        (events as Record<string, unknown>)[eventName] =
          project.events[eventName as keyof EventsConfig];
      } else {
        const eventHandler = EventRegistry.getEventByName(eventName);
        if (eventHandler) {
          const eventConfig = await eventHandler.configuration.configureInteractive();
          events[eventName as keyof EventsConfig] = eventConfig as EventsConfig[keyof EventsConfig];
        }
      }
    }
  }

  const updatedConfig: ProjectConfig = {
    path: relativePath,
    ide,
    events,
  };

  const confirmed = await confirm({
    message: 'Save changes?',
    default: true,
  });

  if (confirmed) {
    config.setProject(name, updatedConfig);
    log.info(`Project '${name}' updated successfully!`);
  }
}

async function deleteProjectManage(ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  // Filter to base projects only
  const baseProjects = Object.keys(projects).filter((name) => !name.includes('#'));

  if (baseProjects.length === 0) {
    log.info('No projects to delete.');
    return;
  }

  const name = await select({
    message: 'Select project to delete:',
    choices: baseProjects.map((n) => ({ name: n, value: n })),
  });

  // Check for branch configs
  const branchPrefix = `${name}#`;
  const branches = Object.keys(projects).filter((n) => n.startsWith(branchPrefix));

  if (branches.length > 0) {
    log.warn(`This project has ${branches.length} branch configuration(s).`);
    const deleteAll = await confirm({
      message: 'Delete all branch configurations as well?',
      default: false,
    });

    if (deleteAll) {
      for (const branch of branches) {
        config.deleteProject(branch);
      }
    }
  }

  const confirmed = await confirm({
    message: `Are you sure you want to delete '${name}'?`,
    default: false,
  });

  if (confirmed) {
    config.deleteProject(name);
    log.info(`Project '${name}' deleted.`);
  }
}

function listProjectsManage(ctx: InteractiveContext): void {
  const { config } = ctx;
  const projects = config.getProjects();
  const defaults = config.getDefaults();

  console.log('\nConfigured projects:\n');

  // Filter to base projects only
  const baseProjects = Object.keys(projects).filter((name) => !name.includes('#'));

  for (const name of baseProjects) {
    const project = projects[name];
    const fullPath = defaults?.base
      ? File.from(defaults.base).join(project.path).path
      : project.path;

    console.log(`  ${name}`);
    console.log(`    Path: ${fullPath}`);
    console.log(`    IDE: ${project.ide || 'not set'}`);
    console.log(`    Events: ${Object.keys(project.events).join(', ') || 'none'}`);

    // Show branch count
    const branchPrefix = `${name}#`;
    const branches = Object.keys(projects).filter((n) => n.startsWith(branchPrefix));
    if (branches.length > 0) {
      console.log(`    Branches: ${branches.length}`);
    }
    console.log();
  }
}

async function editBranchManage(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  const branchPrefix = `${projectName}#`;
  const branches = Object.keys(projects).filter((name) => name.startsWith(branchPrefix));

  if (branches.length === 0) {
    log.info('No branch configurations to edit.');
    return;
  }

  const branchName = await select({
    message: 'Select branch configuration to edit:',
    choices: branches.map((n) => ({
      name: n.substring(branchPrefix.length),
      value: n,
    })),
  });

  const branch = projects[branchName];

  const keepEvents = await confirm({
    message: 'Keep existing event configuration?',
    default: true,
  });

  let events = branch.events;
  if (!keepEvents) {
    const availableEvents = EventRegistry.getEventsForManageUI();
    const currentEvents = Object.keys(branch.events);

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
      if (branch.events[eventName as keyof EventsConfig]) {
        (events as Record<string, unknown>)[eventName] =
          branch.events[eventName as keyof EventsConfig];
      } else {
        const eventHandler = EventRegistry.getEventByName(eventName);
        if (eventHandler) {
          const eventConfig = await eventHandler.configuration.configureInteractive();
          events[eventName as keyof EventsConfig] = eventConfig as EventsConfig[keyof EventsConfig];
        }
      }
    }
  }

  const updatedConfig: ProjectConfig = {
    ...branch,
    events,
  };

  const confirmed = await confirm({
    message: 'Save changes?',
    default: true,
  });

  if (confirmed) {
    config.setProject(branchName, updatedConfig);
    log.info(`Branch configuration '${branchName}' updated successfully!`);
  }
}

async function deleteBranchManage(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();

  const branchPrefix = `${projectName}#`;
  const branches = Object.keys(projects).filter((name) => name.startsWith(branchPrefix));

  if (branches.length === 0) {
    log.info('No branch configurations to delete.');
    return;
  }

  const branchName = await select({
    message: 'Select branch configuration to delete:',
    choices: branches.map((n) => ({
      name: n.substring(branchPrefix.length),
      value: n,
    })),
  });

  const confirmed = await confirm({
    message: `Are you sure you want to delete '${branchName}'?`,
    default: false,
  });

  if (confirmed) {
    config.deleteProject(branchName);
    log.info(`Branch configuration '${branchName}' deleted.`);
  }
}

function listBranchesManage(projectName: string, ctx: InteractiveContext): void {
  const { config } = ctx;
  const projects = config.getProjects();

  const branchPrefix = `${projectName}#`;
  const branches = Object.keys(projects).filter((name) => name.startsWith(branchPrefix));

  console.log(`\nBranch configurations for '${projectName}':\n`);

  for (const branchName of branches) {
    const branch = projects[branchName];
    const shortName = branchName.substring(branchPrefix.length);

    console.log(`  ${shortName}`);
    console.log(`    Events: ${Object.keys(branch.events).join(', ') || 'none'}`);
    console.log();
  }
}
