import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import loog from 'loog';
import omelette from 'omelette';
import File from 'phylo';
import { Config } from '../lib/config.js';
import { EnvironmentRecognizer } from '../lib/environment.js';
import { createOpenCommand } from './open.js';
import { createConfigCommand } from './config/index.js';
import { createManageCommand } from './manage.js';
import { createAddCommand } from './add.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPackageJson(): string {
  // Try multiple paths to find package.json
  const paths = [
    join(__dirname, '../package.json'),
    join(__dirname, '../../package.json'),
    join(process.cwd(), 'package.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  throw new Error('Could not find package.json');
}

interface GlobalOptions {
  debug?: boolean;
  shell?: boolean;
}

export function createCli(): Command {
  const program = new Command();

  // Load package.json for version
  const packageJsonPath = findPackageJson();
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Initialize config and logger
  const config = new Config();
  const log = loog({
    prefixStyle: 'ascii',
    logLevel: 'info',
  });

  // Store package info in config
  config.set('pkg', packageJson);

  // Configure environment recognizer
  EnvironmentRecognizer.configure(config, log);

  // Setup shell completion
  const completion = setupCompletion(config);

  program
    .name('workon')
    .description('Work on something great!')
    .version(packageJson.version)
    .option('-d, --debug', 'Enable debug logging')
    .option('--completion', 'Setup shell tab completion')
    .option('--shell', 'Output shell commands for evaluation')
    .option('--init', 'Generate shell integration function')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<GlobalOptions>();
      if (opts.debug) {
        log.setLogLevel('debug');
      }
    })
    .action(async (options: GlobalOptions & { completion?: boolean; init?: boolean }) => {
      if (options.debug) {
        log.setLogLevel('debug');
      }

      if (options.completion) {
        log.debug('Setting up command-line completion');
        completion.setupShellInitFile();
        return;
      }

      if (options.init) {
        log.debug('Generating shell integration function');
        outputShellInit(program);
        return;
      }

      // Default action: run interactive mode or show help
      const environment = await EnvironmentRecognizer.recognize(File.cwd());
      program.setOptionValue('_environment', environment);
      program.setOptionValue('_config', config);
      program.setOptionValue('_log', log);

      // Import and run interactive command
      const { runInteractive } = await import('./interactive.js');
      await runInteractive({ config, log, environment });
    });

  // Store shared state for subcommands
  program.setOptionValue('_config', config);
  program.setOptionValue('_log', log);

  // Add commands
  program.addCommand(createOpenCommand({ config, log }));
  program.addCommand(createAddCommand({ config, log }));
  program.addCommand(createConfigCommand({ config, log }));
  program.addCommand(createManageCommand({ config, log }));

  // Handle unknown commands as project names
  program.on('command:*', async (operands) => {
    const projectName = operands[0];

    // Check if it looks like a project name (not a flag)
    if (projectName && !projectName.startsWith('-')) {
      const openCmd = program.commands.find((c) => c.name() === 'open');
      if (openCmd) {
        // Re-parse with open command and project name
        const args = [
          'open',
          ...operands,
          ...process.argv.slice(2).filter((a) => a.startsWith('-')),
        ];
        await program.parseAsync(['node', 'workon', ...args]);
        return;
      }
    }

    console.error(`Unknown command: ${operands.join(' ')}`);
    program.help();
  });

  program.showHelpAfterError(true);

  return program;
}

function setupCompletion(config: Config): ReturnType<typeof omelette> {
  const tree: Record<string, string[] | null> = {
    config: ['list', 'set', 'unset'],
    manage: null,
  };

  const projects = config.getProjects();
  if (projects) {
    Object.keys(projects).forEach((id) => {
      tree[id] = null;
    });
  }

  const completion = omelette('workon').tree(tree);
  completion.init();

  return completion;
}

function outputShellInit(program: Command): void {
  // Get list of available commands
  const cmdNames = program.commands.map((c) => c.name());

  // Get list of available options
  const switchFlags: string[] = [];
  program.options.forEach((opt) => {
    switchFlags.push('--' + opt.long?.replace(/^--/, ''));
    if (opt.short) {
      switchFlags.push(opt.short);
    }
  });

  // Built-in flags
  const builtinFlags = ['--help', '-h', '--version', '-V', 'help'];

  // Combine all non-shell commands and flags
  const nonShellCommands = [...new Set([...cmdNames, ...switchFlags, ...builtinFlags])];
  const casePattern = nonShellCommands.join('|');

  // Generate shell function
  const shellFunction = `
# workon shell integration
workon() {
    # Commands and flags that should NOT use shell mode
    case "$1" in
        ${casePattern})
            command workon "$@"
            return $?
            ;;
    esac

    # If no arguments provided, run interactive mode directly
    if [[ $# -eq 0 ]]; then
        command workon "$@"
        return $?
    fi

    # Default behavior: use shell mode for project opening
    local output
    output=$(command workon --shell "$@" 2>&1)
    local exit_code=$?

    if [[ $exit_code -eq 0 && -n "$output" ]]; then
        # Execute shell commands if workon succeeded and output exists
        eval "$output"
    else
        # Show any error output
        [[ -n "$output" ]] && echo "$output" >&2
        return $exit_code
    fi
}`;

  console.log(shellFunction);
}
