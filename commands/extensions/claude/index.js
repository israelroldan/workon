const BaseCommand = require('../../base');
const inquirer = require('inquirer');
const spawn = require('child_process').spawn;

/**
 * Claude Command
 * Launches Claude Code with optional configuration
 */
class ClaudeCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'claude',
            displayName: 'Launch Claude Code',
            description: 'Launch Claude Code with optional flags and configuration',
            category: 'development',
            requiresTmux: true,
            dependencies: ['claude']
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                
                if (typeof config === 'object' && config !== null) {
                    // Validate flags if present
                    if (config.flags) {
                        if (!Array.isArray(config.flags)) {
                            return 'Claude flags must be an array';
                        }
                        
                        // Basic flag validation - ensure they start with - or --
                        const invalidFlags = config.flags.filter(flag => 
                            typeof flag !== 'string' || (!flag.startsWith('-') && !flag.startsWith('--'))
                        );
                        
                        if (invalidFlags.length > 0) {
                            return `Invalid Claude flags: ${invalidFlags.join(', ')}. Flags must start with - or --`;
                        }
                    }

                    // Validate split_terminal if present
                    if (config.split_terminal !== undefined && typeof config.split_terminal !== 'boolean') {
                        return 'Claude split_terminal must be a boolean';
                    }
                    
                    return true;
                }
                
                return 'Claude configuration must be a boolean, string "true"/"false", or configuration object';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                console.log('\n⚙️  Configure Claude Event\n');
                
                const claudeQuestions = [
                    {
                        type: 'confirm',
                        name: 'useAdvanced',
                        message: 'Configure advanced Claude options?',
                        default: false
                    }
                ];

                const claudeAnswer = await inquirer.prompt(claudeQuestions);
                
                if (!claudeAnswer.useAdvanced) {
                    return 'true';
                }

                const advancedQuestions = [
                    {
                        type: 'input',
                        name: 'flags',
                        message: 'Claude flags (comma-separated, e.g. --resume,--debug):',
                        filter: (input) => {
                            if (!input.trim()) return [];
                            return input.split(',').map(flag => flag.trim()).filter(flag => flag);
                        }
                    },
                    {
                        type: 'confirm',
                        name: 'split_terminal',
                        message: 'Enable split terminal (Claude + shell side-by-side with tmux)?',
                        default: false
                    }
                ];

                const advancedAnswers = await inquirer.prompt(advancedQuestions);
                
                const configObj = {};

                if (advancedAnswers.flags && advancedAnswers.flags.length > 0) {
                    configObj.flags = advancedAnswers.flags;
                }

                if (advancedAnswers.split_terminal) {
                    configObj.split_terminal = true;
                }

                return Object.keys(configObj).length > 0 ? configObj : 'true';
            },

            getDefaultConfig() {
                return 'true';
            }
        };
    }

    static get processing() {
        return {
            async processEvent(context) {
                const { project, isShellMode, shellCommands } = context;
                const claudeConfig = project.events.claude;
                
                let claudeArgs = [];
                
                // Handle advanced Claude configuration
                if (claudeConfig && typeof claudeConfig === 'object') {
                    if (claudeConfig.flags && Array.isArray(claudeConfig.flags)) {
                        claudeArgs = claudeArgs.concat(claudeConfig.flags);
                    }
                }
                
                if (isShellMode) {
                    let claudeCommand = claudeArgs.length > 0 
                        ? `claude ${claudeArgs.join(' ')}`
                        : 'claude';
                    shellCommands.push(claudeCommand);
                } else {
                    spawn('claude', claudeArgs, {
                        cwd: project.path.path,
                        stdio: 'inherit'
                    });
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                const claudeConfig = project.events.claude;
                
                let claudeArgs = [];
                
                // Handle advanced Claude configuration
                if (claudeConfig && typeof claudeConfig === 'object') {
                    if (claudeConfig.flags && Array.isArray(claudeConfig.flags)) {
                        claudeArgs = claudeArgs.concat(claudeConfig.flags);
                    }
                }
                
                const claudeCommand = claudeArgs.length > 0 
                    ? `claude ${claudeArgs.join(' ')}`
                    : 'claude';
                    
                return [claudeCommand];
            }
        };
    }

    static get tmux() {
        return {
            getLayoutPriority() {
                return 100; // High priority for Claude
            },

            contributeToLayout(enabledCommands) {
                // Claude prefers split terminal layouts
                const hasCwd = enabledCommands.some(cmd => cmd.name === 'cwd');
                const hasNpm = enabledCommands.some(cmd => cmd.name === 'npm');
                
                if (hasCwd && hasNpm) {
                    return 'three-pane'; // Claude + Terminal + NPM
                } else if (hasCwd) {
                    return 'split-terminal'; // Claude + Terminal
                } else {
                    return 'single'; // Just Claude
                }
            }
        };
    }

    static get help() {
        return {
            usage: 'claude: <configuration>',
            description: 'Launch Claude Code with optional flags and configuration',
            examples: [
                { 
                    config: 'claude: true', 
                    description: 'Launch Claude Code with default settings' 
                },
                { 
                    config: 'claude: { flags: ["--resume", "--debug"] }', 
                    description: 'Launch Claude with specific flags' 
                },
                { 
                    config: 'claude: { split_terminal: true }', 
                    description: 'Launch Claude in split terminal with tmux' 
                }
            ]
        };
    }
}

module.exports = ClaudeCommand;