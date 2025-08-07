const BaseCommand = require('../../base');
const spawn = require('child_process').spawn;

/**
 * IDE Command
 * Opens the project in the configured IDE/editor
 */
class IdeCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'ide',
            displayName: 'Open in IDE',
            description: 'Open project in configured IDE/editor',
            category: 'core',
            requiresTmux: false,
            dependencies: []
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                // IDE command accepts boolean or string 'true'
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                return 'IDE configuration must be a boolean or string "true"/"false"';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                // IDE configuration is handled at the project level (project.ide)
                // This event just enables/disables opening the IDE
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
                    shellCommands.push(`${project.ide} "${project.path.path}" &`);
                } else {
                    // In non-shell mode, spawn the IDE directly
                    spawn(project.ide, [project.path.path]);
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                return [`${project.ide} "${project.path.path}" &`];
            }
        };
    }

    static get help() {
        return {
            usage: 'ide: true',
            description: 'Opens the project in the configured IDE/editor',
            examples: [
                { 
                    config: 'ide: true', 
                    description: 'Enable opening project in IDE when switching to project' 
                },
                { 
                    config: 'ide: false', 
                    description: 'Disable automatic IDE opening' 
                }
            ]
        };
    }
}

module.exports = IdeCommand;