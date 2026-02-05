import { select, input, checkbox, confirm } from '@inquirer/prompts';
import File from 'phylo';
import path from 'path';
import deepAssign from 'deep-assign';
import chalk from 'chalk';
import type { Config } from '../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig } from '../types/index.js';
import type { Environment, ProjectEnvironment as ProjectEnv } from '../lib/environment.js';
import { ProjectEnvironment } from '../lib/environment.js';
import { EventRegistry } from '../events/registry.js';
import { IDE_CHOICES } from '../types/constants.js';
import { WorktreeManager } from '../lib/worktree.js';
import type { ProjectContext } from './worktrees/utils.js';

interface InteractiveContext {
  config: Config;
  log: Logger;
  environment: Environment;
  suggestedName?: string;
}

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

    case 'manage-worktrees':
      await manageWorktrees(defaultName, ctx);
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
        { name: 'Manage worktrees', value: 'manage-worktrees' },
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

  await config.setProjectSafe(name, projectConfig);

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

  await config.setProjectSafe(branchName, branchConfig);

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
    await config.setProjectSafe(name, projectConfig);
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
    await config.setProjectSafe(name, updatedConfig);
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
        await config.deleteProjectSafe(branch);
      }
    }
  }

  const confirmed = await confirm({
    message: `Are you sure you want to delete '${name}'?`,
    default: false,
  });

  if (confirmed) {
    await config.deleteProjectSafe(name);
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
    await config.setProjectSafe(branchName, updatedConfig);
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
    await config.deleteProjectSafe(branchName);
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

// Worktree management functions
async function manageWorktrees(projectName: string, ctx: InteractiveContext): Promise<void> {
  const { config, log } = ctx;
  const projects = config.getProjects();
  const defaults = config.getDefaults();

  if (!(projectName in projects)) {
    log.error(`Project '${projectName}' not found.`);
    return;
  }

  const projectConfig = projects[projectName];
  const basePath = defaults?.base || '';

  // Resolve project path
  let projectPath: string;
  const configPath = File.from(projectConfig.path);
  if (configPath.path.startsWith('/') || configPath.path.startsWith('~')) {
    projectPath = configPath.absolutify().path;
  } else if (basePath) {
    projectPath = File.from(basePath).absolutify().join(projectConfig.path).path;
  } else {
    projectPath = configPath.absolutify().path;
  }

  const manager = new WorktreeManager(projectPath, projectName);

  if (!(await manager.isGitRepository())) {
    log.error(`'${projectName}' is not a git repository`);
    return;
  }

  const worktrees = await manager.list();
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);
  const hasWorktrees = nonMainWorktrees.length > 0;

  const choices = [
    { name: 'List worktrees', value: 'list' },
    { name: 'Create worktree', value: 'add' },
    ...(hasWorktrees
      ? [
          { name: 'Open worktree', value: 'open' },
          { name: 'Remove worktree', value: 'remove' },
          { name: 'Merge worktree', value: 'merge' },
          { name: 'Create branch from worktree', value: 'branch' },
        ]
      : []),
    { name: 'Back', value: 'back' },
  ];

  const action = await select({
    message: `Manage worktrees for '${projectName}':`,
    choices,
  });

  switch (action) {
    case 'list':
      await listWorktreesManage(projectName, manager);
      break;
    case 'add':
      await addWorktreeManage(projectName, manager, log);
      break;
    case 'open':
      await openWorktreeManage(projectName, manager, config, log);
      break;
    case 'remove':
      await removeWorktreeManage(projectName, manager, log);
      break;
    case 'merge':
      await mergeWorktreeManage(projectName, manager, log);
      break;
    case 'branch':
      await branchWorktreeManage(projectName, manager, log);
      break;
    case 'back':
      return;
  }

  // Return to manage worktrees menu
  await manageWorktrees(projectName, ctx);
}

async function listWorktreesManage(projectName: string, manager: WorktreeManager): Promise<void> {
  const worktrees = await manager.list();
  const managedWorktrees = await manager.listManagedWorktrees();
  const managedPaths = new Set(managedWorktrees.map((wt) => wt.path));

  console.log(chalk.bold(`\nWorktrees for ${projectName}:`));
  console.log('-'.repeat(60));

  for (const wt of worktrees) {
    const isManaged = managedPaths.has(wt.path);
    const mainLabel = wt.isMain ? chalk.gray(' (main)') : '';
    const externalLabel = !wt.isMain && !isManaged ? chalk.yellow(' (external)') : '';
    const branchDisplay =
      wt.branch === '(detached)' ? chalk.yellow(wt.branch) : chalk.green(wt.branch);

    console.log(`  ${chalk.cyan(wt.name)}${mainLabel}${externalLabel}`);
    console.log(`    Branch: ${branchDisplay}`);
    console.log(`    Path:   ${chalk.gray(wt.path)}`);
    console.log();
  }
}

async function addWorktreeManage(
  projectName: string,
  manager: WorktreeManager,
  log: Logger
): Promise<void> {
  const branchName = await input({
    message: 'Branch name for the new worktree:',
    validate: (value) => {
      if (!value.trim()) return 'Branch name is required';
      return true;
    },
  });

  const branchExists = await manager.branchExists(branchName);
  let baseBranch: string | undefined;

  if (!branchExists) {
    const branches = await manager.getBranches();
    const currentBranch = await manager.getCurrentBranch();

    baseBranch = await select({
      message: `Branch '${branchName}' doesn't exist. Create from which branch?`,
      choices: branches.map((b) => ({
        name: b === currentBranch ? `${b} (current)` : b,
        value: b,
      })),
      default: currentBranch,
    });
  }

  try {
    const worktree = await manager.add({ branch: branchName, baseBranch });
    log.info(`Worktree created at ${worktree.path}`);

    // Run post-setup hook if exists
    if (manager.hasSetupHook()) {
      const runHook = await confirm({
        message: 'Run post-setup hook?',
        default: true,
      });

      if (runHook) {
        try {
          await manager.runPostSetupHook(worktree.path);
          log.info('Post-setup hook completed');
        } catch (error) {
          log.warn(`Post-setup hook failed: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    log.error(`Failed to create worktree: ${(error as Error).message}`);
  }
}

async function openWorktreeManage(
  projectName: string,
  manager: WorktreeManager,
  config: Config,
  log: Logger
): Promise<void> {
  const worktrees = await manager.list();
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);

  if (nonMainWorktrees.length === 0) {
    log.info('No worktrees to open.');
    return;
  }

  const worktreeName = await select({
    message: 'Select worktree to open:',
    choices: nonMainWorktrees.map((wt) => ({
      name: `${wt.name} (${wt.branch})`,
      value: wt.name,
    })),
  });

  // Build ProjectContext for runWorktreeOpen
  const projects = config.getProjects();
  const defaults = config.getDefaults();
  const projectConfig = projects[projectName];
  const basePath = defaults?.base || '';

  let projectPath: string;
  const configPath = File.from(projectConfig.path);
  if (configPath.path.startsWith('/') || configPath.path.startsWith('~')) {
    projectPath = configPath.absolutify().path;
  } else if (basePath) {
    projectPath = File.from(basePath).absolutify().join(projectConfig.path).path;
  } else {
    projectPath = configPath.absolutify().path;
  }

  const projectCtx: ProjectContext = {
    projectPath,
    projectName,
    projectConfig,
    isRegistered: true,
    worktreeInfo: {
      isWorktree: false,
      worktreePath: null,
      mainRepoPath: projectPath,
      worktreeName: null,
      branch: null,
    },
  };

  // Import and call the open worktree command logic
  const { runWorktreeOpen } = await import('./worktrees/open.js');
  await runWorktreeOpen(projectCtx, worktreeName, {}, { config, log });
}

async function removeWorktreeManage(
  projectName: string,
  manager: WorktreeManager,
  log: Logger
): Promise<void> {
  const worktrees = await manager.list();
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);

  if (nonMainWorktrees.length === 0) {
    log.info('No worktrees to remove.');
    return;
  }

  const worktreeName = await select({
    message: 'Select worktree to remove:',
    choices: nonMainWorktrees.map((wt) => ({
      name: `${wt.name} (${wt.branch})`,
      value: wt.name,
    })),
  });

  const hasChanges = await manager.hasUncommittedChanges(worktreeName);
  if (hasChanges) {
    log.warn(`Worktree '${worktreeName}' has uncommitted changes.`);
    const force = await confirm({
      message: 'Force removal and lose changes?',
      default: false,
    });

    if (!force) {
      log.info('Removal cancelled.');
      return;
    }
  }

  const confirmed = await confirm({
    message: `Remove worktree '${worktreeName}'?`,
    default: true,
  });

  if (confirmed) {
    try {
      await manager.remove(worktreeName, true);
      log.info(`Worktree '${worktreeName}' removed.`);
    } catch (error) {
      log.error(`Failed to remove worktree: ${(error as Error).message}`);
    }
  }
}

async function mergeWorktreeManage(
  projectName: string,
  manager: WorktreeManager,
  log: Logger
): Promise<void> {
  const worktrees = await manager.list();
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain && wt.branch !== '(detached)');

  if (nonMainWorktrees.length === 0) {
    log.info('No worktrees to merge (detached worktrees must be branched first).');
    return;
  }

  const worktreeName = await select({
    message: 'Select worktree to merge:',
    choices: nonMainWorktrees.map((wt) => ({
      name: `${wt.name} (${wt.branch})`,
      value: wt.name,
    })),
  });

  const worktree = await manager.get(worktreeName);
  if (!worktree) return;

  const hasChanges = await manager.hasUncommittedChanges(worktreeName);
  if (hasChanges) {
    log.error(`Worktree '${worktreeName}' has uncommitted changes. Commit or stash them first.`);
    return;
  }

  const branches = await manager.getBranches();
  const targetBranches = branches.filter((b) => b !== worktree.branch);

  const commonTargets = ['main', 'master', 'develop', 'dev'];
  const defaultTarget = commonTargets.find((t) => targetBranches.includes(t)) || targetBranches[0];

  const targetBranch = await select({
    message: `Merge '${worktree.branch}' into which branch?`,
    choices: targetBranches.map((b) => ({ name: b, value: b })),
    default: defaultTarget,
  });

  const squash = await confirm({
    message: 'Use squash merge?',
    default: false,
  });

  const removeAfter = await confirm({
    message: 'Remove worktree after merge?',
    default: true,
  });

  try {
    await manager.merge(worktreeName, { targetBranch, squash });
    log.info(`Merged '${worktree.branch}' into '${targetBranch}'`);

    if (removeAfter) {
      await manager.remove(worktreeName, true);
      log.info(`Worktree '${worktreeName}' removed.`);
    }
  } catch (error) {
    log.error(`Merge failed: ${(error as Error).message}`);
  }
}

async function branchWorktreeManage(
  projectName: string,
  manager: WorktreeManager,
  log: Logger
): Promise<void> {
  const worktrees = await manager.list();
  const detachedWorktrees = worktrees.filter((wt) => !wt.isMain);

  if (detachedWorktrees.length === 0) {
    log.info('No worktrees available.');
    return;
  }

  const worktreeName = await select({
    message: 'Select worktree to create branch from:',
    choices: detachedWorktrees.map((wt) => ({
      name: `${wt.name} (${wt.branch})`,
      value: wt.name,
    })),
  });

  const worktree = await manager.get(worktreeName);
  if (!worktree) return;

  const branchName = await input({
    message: 'New branch name:',
    validate: async (value) => {
      if (!value.trim()) return 'Branch name is required';
      if (await manager.branchExists(value)) return 'Branch already exists';
      return true;
    },
  });

  const { simpleGit } = await import('simple-git');
  const worktreeGit = simpleGit(worktree.path);

  try {
    await worktreeGit.checkoutLocalBranch(branchName);
    log.info(`Branch '${branchName}' created and checked out`);

    const push = await confirm({
      message: 'Push to origin for PR?',
      default: true,
    });

    if (push) {
      await worktreeGit.push('origin', branchName, ['--set-upstream']);
      log.info(`Pushed to origin/${branchName}`);
    }
  } catch (error) {
    log.error(`Failed to create branch: ${(error as Error).message}`);
  }
}

/**
 * Interactive worktree management using ProjectContext from CWD detection.
 * This is the entry point for `workon worktrees` when no subcommand is provided.
 */
export async function manageWorktreesInteractive(
  projectCtx: ProjectContext,
  ctx: { config: Config; log: Logger }
): Promise<void> {
  const { config, log } = ctx;
  const { projectPath, projectName } = projectCtx;
  const displayName = projectName || path.basename(projectPath);

  const manager = new WorktreeManager(projectPath, projectName ?? undefined);

  if (!(await manager.isGitRepository())) {
    log.error(`'${displayName}' is not a git repository`);
    return;
  }

  const worktrees = await manager.list();
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);
  const hasWorktrees = nonMainWorktrees.length > 0;

  const choices = [
    { name: 'List worktrees', value: 'list' },
    { name: 'Create worktree', value: 'add' },
    ...(hasWorktrees
      ? [
          { name: 'Open worktree', value: 'open' },
          { name: 'Remove worktree', value: 'remove' },
          { name: 'Merge worktree', value: 'merge' },
          { name: 'Create branch from worktree', value: 'branch' },
        ]
      : []),
    { name: 'Exit', value: 'exit' },
  ];

  const action = await select({
    message: `Manage worktrees for '${displayName}':`,
    choices,
  });

  switch (action) {
    case 'list':
      await listWorktreesManage(displayName, manager);
      break;
    case 'add':
      await addWorktreeManage(displayName, manager, log);
      break;
    case 'open':
      if (projectName) {
        await openWorktreeManage(projectName, manager, config, log);
      } else {
        log.warn('Cannot open worktree session: project is not registered.');
        log.info(`Register this project first with 'workon add .'`);
      }
      break;
    case 'remove':
      await removeWorktreeManage(displayName, manager, log);
      break;
    case 'merge':
      await mergeWorktreeManage(displayName, manager, log);
      break;
    case 'branch':
      await branchWorktreeManage(displayName, manager, log);
      break;
    case 'exit':
      return;
  }

  // Return to manage worktrees menu
  await manageWorktreesInteractive(projectCtx, ctx);
}
