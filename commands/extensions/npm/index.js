const BaseCommand = require('../../base');
const inquirer = require('inquirer');
const spawn = require('child_process').spawn;

/**
 * NPM Command
 * Executes NPM scripts in the project directory
 */
class NpmCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'npm',
            displayName: 'Run NPM command',
            description: 'Execute NPM scripts in project directory',
            category: 'development',
            requiresTmux: true,
            dependencies: ['npm']
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                
                if (typeof config === 'string' && config.trim() !== '') {
                    return true; // Simple string command
                }
                
                if (typeof config === 'object' && config !== null) {
                    // Validate command if present
                    if (config.command) {
                        if (typeof config.command !== 'string' || config.command.trim() === '') {
                            return 'NPM command must be a non-empty string';
                        }
                    }

                    // Validate watch if present
                    if (config.watch !== undefined && typeof config.watch !== 'boolean') {
                        return 'NPM watch must be a boolean';
                    }

                    // Validate auto_restart if present
                    if (config.auto_restart !== undefined && typeof config.auto_restart !== 'boolean') {
                        return 'NPM auto_restart must be a boolean';
                    }
                    
                    return true;
                }
                
                return 'NPM configuration must be a boolean, string command, or configuration object';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                console.log('\n📦 Configure NPM Event\n');
                
                const npmQuestions = [
                    {
                        type: 'input',
                        name: 'command',
                        message: 'NPM script to run (e.g., dev, start, test):',
                        default: 'dev',
                        validate: (value) => {
                            if (!value.trim()) {
                                return 'NPM command cannot be empty';
                            }
                            return true;
                        }
                    },
                    {
                        type: 'confirm',
                        name: 'useAdvanced',
                        message: 'Configure advanced NPM options?',
                        default: false
                    }
                ];

                const basicAnswers = await inquirer.prompt(npmQuestions);
                
                if (!basicAnswers.useAdvanced) {
                    return basicAnswers.command;
                }

                const advancedQuestions = [
                    {
                        type: 'confirm',
                        name: 'watch',
                        message: 'Enable watch mode (if supported by command)?',
                        default: true
                    },
                    {
                        type: 'confirm',
                        name: 'auto_restart',
                        message: 'Auto-restart on crashes?',
                        default: false
                    }
                ];

                const advancedAnswers = await inquirer.prompt(advancedQuestions);
                
                const configObj = {
                    command: basicAnswers.command
                };

                if (advancedAnswers.watch) {
                    configObj.watch = true;
                }

                if (advancedAnswers.auto_restart) {
                    configObj.auto_restart = true;
                }

                return configObj;
            },

            getDefaultConfig() {
                return 'dev';
            }
        };
    }

    static get processing() {
        return {
            async processEvent(context) {
                const { project, isShellMode, shellCommands } = context;
                const npmConfig = project.events.npm;
                const npmCommand = NpmCommand._getNpmCommand(npmConfig);
                
                if (isShellMode) {
                    shellCommands.push(npmCommand);
                } else {
                    const scriptName = npmCommand.replace('npm run ', '');
                    spawn('npm', ['run', scriptName], {
                        cwd: project.path.path,
                        stdio: 'inherit'
                    });
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                const npmConfig = project.events.npm;
                return [NpmCommand._getNpmCommand(npmConfig)];
            }
        };
    }

    static _getNpmCommand(npmConfig) {
        if (typeof npmConfig === 'string') {
            return `npm run ${npmConfig}`;
        } else if (npmConfig && typeof npmConfig === 'object' && npmConfig.command) {
            return `npm run ${npmConfig.command}`;
        } else {
            return 'npm run dev';
        }
    }

    static get tmux() {
        return {
            getLayoutPriority() {
                return 50; // Medium priority for NPM
            },

            contributeToLayout(enabledCommands) {
                // NPM works well in multi-pane layouts
                const hasCwd = enabledCommands.some(cmd => cmd.name === 'cwd');
                const hasClaude = enabledCommands.some(cmd => cmd.name === 'claude');
                
                if (hasCwd && hasClaude) {
                    return 'three-pane'; // Claude + Terminal + NPM
                } else if (hasCwd) {
                    return 'two-pane-npm'; // Terminal + NPM
                } else {
                    return 'single'; // Just NPM
                }
            }
        };
    }

    static get help() {
        return {
            usage: 'npm: <script-name> | <configuration>',
            description: 'Execute NPM scripts in the project directory',
            examples: [
                { 
                    config: 'npm: "dev"', 
                    description: 'Run npm run dev' 
                },
                { 
                    config: 'npm: { command: "test", watch: true }', 
                    description: 'Run tests in watch mode' 
                },
                { 
                    config: 'npm: { command: "start", auto_restart: true }', 
                    description: 'Run start script with auto-restart on crashes' 
                }
            ]
        };
    }
}

module.exports = NpmCommand;