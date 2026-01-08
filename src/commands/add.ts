import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';
import File from 'phylo';
import { confirm } from '@inquirer/prompts';
import type { Config } from '../lib/config.js';
import type { Logger, ProjectConfig, IdeType } from '../types/index.js';

interface AddContext {
  config: Config;
  log: Logger;
}

interface AddOptions {
  debug?: boolean;
  name?: string;
  ide?: IdeType;
  force?: boolean;
}

interface ProjectDiscovery {
  name: string;
  isNode: boolean;
  isBun: boolean;
  detectedIde: IdeType | null;
  packageJson: Record<string, unknown> | null;
}

export function createAddCommand(ctx: AddContext): Command {
  const { log } = ctx;

  return new Command('add')
    .description('Add a project from a directory path')
    .argument('[path]', 'Path to the project directory (defaults to current directory)', '.')
    .option('-d, --debug', 'Enable debug logging')
    .option('-n, --name <name>', 'Override the detected project name')
    .option(
      '-i, --ide <ide>',
      'Specify the IDE to use (vscode, idea, atom, code, subl, vim, emacs)'
    )
    .option('-f, --force', 'Overwrite existing project with same name')
    .action(async (pathArg: string, options: AddOptions) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      await addProject(pathArg, options, ctx);
    });
}

async function addProject(pathArg: string, options: AddOptions, ctx: AddContext): Promise<void> {
  const { config, log } = ctx;
  const defaults = config.getDefaults();
  const projects = config.getProjects();

  // Resolve the path
  const targetPath = resolve(pathArg);
  log.debug(`Resolved path: ${targetPath}`);

  // Validate path exists and is a directory
  if (!existsSync(targetPath)) {
    log.error(`Path does not exist: ${targetPath}`);
    process.exit(1);
  }

  const pathFile = File.from(targetPath);
  try {
    const stat = pathFile.stat();
    if (!stat.isDirectory()) {
      log.error(`Path is not a directory: ${targetPath}`);
      process.exit(1);
    }
  } catch {
    log.error(`Cannot access path: ${targetPath}`);
    process.exit(1);
  }

  // Auto-discover project details
  const discovery = discoverProject(targetPath, log);
  log.debug(`Discovery result: ${JSON.stringify(discovery)}`);

  // Determine project name
  const projectName = options.name || discovery.name;
  log.debug(`Project name: ${projectName}`);

  // Validate project name
  if (!/^[\w-]+$/.test(projectName)) {
    log.error(`Invalid project name: ${projectName}`);
    log.error('Name can only contain letters, numbers, underscores, and hyphens');
    process.exit(1);
  }

  // Check for existing project
  if (projectName in projects && !options.force) {
    const overwrite = await confirm({
      message: `Project '${projectName}' already exists. Overwrite?`,
      default: false,
    });

    if (!overwrite) {
      log.info('Cancelled.');
      return;
    }
  }

  // Determine IDE
  const ide: IdeType = options.ide || discovery.detectedIde || 'vscode';
  log.debug(`IDE: ${ide}`);

  // Calculate relative path if possible
  let relativePath = targetPath;
  if (defaults?.base) {
    const baseDir = File.from(defaults.base);
    try {
      const relPath = pathFile.relativize(baseDir.path);
      if (relPath && !relPath.path.startsWith('..')) {
        relativePath = relPath.path;
      }
    } catch {
      // Keep absolute path
    }
  }
  log.debug(`Relative path: ${relativePath}`);

  // Build project config
  const projectConfig: ProjectConfig = {
    path: relativePath,
    ide,
    events: {
      cwd: true,
      ide: true,
    },
  };

  // Add npm event if it's a Node/Bun project with scripts
  if ((discovery.isNode || discovery.isBun) && discovery.packageJson) {
    const scripts = discovery.packageJson.scripts as Record<string, string> | undefined;
    if (scripts && (scripts.dev || scripts.start)) {
      projectConfig.events.npm = scripts.dev ? 'dev' : 'start';
    }
  }

  // Save the project
  config.setProject(projectName, projectConfig);

  // Output success
  log.info(`Added project '${projectName}'`);
  log.info(`  Path: ${relativePath}`);
  log.info(`  IDE: ${ide}`);
  log.info(`  Events: ${Object.keys(projectConfig.events).join(', ')}`);
  log.info('');
  log.info(`Use 'workon ${projectName}' to start working!`);
}

function discoverProject(targetPath: string, log: Logger): ProjectDiscovery {
  const dirName = basename(targetPath);

  const discovery: ProjectDiscovery = {
    name: dirName,
    isNode: false,
    isBun: false,
    detectedIde: null,
    packageJson: null,
  };

  // Check for package.json (Node project)
  const packageJsonPath = resolve(targetPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    discovery.isNode = true;
    log.debug('Detected Node project (package.json found)');

    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      discovery.packageJson = JSON.parse(content);

      // Use package.json name if available and valid
      const pkgName = discovery.packageJson?.name as string | undefined;
      if (pkgName && /^[\w-]+$/.test(pkgName)) {
        discovery.name = pkgName;
        log.debug(`Using name from package.json: ${pkgName}`);
      }
    } catch (error) {
      log.debug(`Failed to parse package.json: ${(error as Error).message}`);
    }
  }

  // Check for bun.lockb (Bun project)
  const bunLockPath = resolve(targetPath, 'bun.lockb');
  if (existsSync(bunLockPath)) {
    discovery.isBun = true;
    log.debug('Detected Bun project (bun.lockb found)');
  }

  // Detect IDE from config directories
  const vscodeDir = resolve(targetPath, '.vscode');
  const ideaDir = resolve(targetPath, '.idea');

  if (existsSync(vscodeDir)) {
    discovery.detectedIde = 'vscode';
    log.debug('Detected VS Code (.vscode directory found)');
  } else if (existsSync(ideaDir)) {
    discovery.detectedIde = 'idea';
    log.debug('Detected IntelliJ IDEA (.idea directory found)');
  }

  return discovery;
}
