const BaseCommand = require('../../base');
const spawn = require('child_process').spawn;

/**
 * CWD (Change Working Directory) Command
 * Changes the current working directory to the project path
 */
class CwdCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'cwd',
            displayName: 'Change directory (cwd)',
            description: 'Change current working directory to project path',
            category: 'core',
            requiresTmux: false,
            dependencies: []
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                // CWD command accepts boolean or string 'true'
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                return 'CWD configuration must be a boolean or string "true"/"false"';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                // CWD is typically just enabled/disabled, no advanced config needed
                return 'true';
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
                
                if (isShellMode) {
                    shellCommands.push(`cd "${project.path.path}"`);
                } else {
                    // In non-shell mode, spawn a new shell in the project directory
                    spawn(process.env.SHELL, ['-i'], {
                        cwd: project.path.path,
                        stdio: 'inherit'
                    });
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                return [`cd "${project.path.path}"`];
            }
        };
    }

    static get help() {
        return {
            usage: 'cwd: true',
            description: 'Changes the current working directory to the project path',
            examples: [
                { 
                    config: 'cwd: true', 
                    description: 'Enable directory change when opening project' 
                },
                { 
                    config: 'cwd: false', 
                    description: 'Disable directory change (stay in current directory)' 
                }
            ]
        };
    }
}

module.exports = CwdCommand;