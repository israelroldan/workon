import { select, input, checkbox } from '@inquirer/prompts';
import File from 'phylo';
import deepAssign from 'deep-assign';
import type { Config } from '../lib/config.js';
import type { Logger, ProjectConfig, EventsConfig, IdeType } from '../types/index.js';
import type { Environment, ProjectEnvironment as ProjectEnv } from '../lib/environment.js';

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
      log.info('Switch to an existing project');
      // TODO: Implement project switching
      break;

    case 'switch-branch':
      log.info('Switch to an existing branch');
      // TODO: Implement branch switching
      break;

    case 'manage-projects':
      log.info('Manage existing projects');
      // Redirect to manage command
      break;

    case 'manage-branches':
      log.info('Manage existing branches');
      // TODO: Implement branch management
      break;
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

  // Create branch config by inheriting from base project
  const branchConfig = deepAssign({}, baseProject, { branch }) as ProjectConfig;
  delete (branchConfig as any).name;

  projects[branchName] = branchConfig;
  config.set('projects', projects);

  log.info('Your branch configuration has been initialized.');
  log.info(`Use 'workon ${branchName}' to start working!`);
}
