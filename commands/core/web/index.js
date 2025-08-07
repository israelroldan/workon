const BaseCommand = require('../../base');

/**
 * Web Command
 * Opens the project homepage in a web browser
 */
class WebCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'web',
            displayName: 'Open homepage in browser',
            description: 'Open project homepage in web browser',
            category: 'core',
            requiresTmux: false,
            dependencies: []
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                // Web command accepts boolean or string 'true'
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                return 'Web configuration must be a boolean or string "true"/"false"';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                // Web event just enables/disables opening the homepage
                // The actual homepage URL is configured at the project level
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
                const homepage = project.homepage;
                
                if (!homepage) {
                    // No homepage configured, skip
                    return;
                }
                
                if (isShellMode) {
                    // Different approaches based on OS
                    let openCmd;
                    switch (process.platform) {
                        case 'darwin': openCmd = 'open'; break;
                        case 'win32': openCmd = 'start'; break;
                        default: openCmd = 'xdg-open'; break;
                    }
                    shellCommands.push(`${openCmd} "${homepage}" &`);
                } else {
                    // In non-shell mode, use openurl2
                    require("openurl2").open(homepage);
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                const homepage = project.homepage;
                
                if (!homepage) {
                    return [];
                }
                
                let openCmd;
                switch (process.platform) {
                    case 'darwin': openCmd = 'open'; break;
                    case 'win32': openCmd = 'start'; break;
                    default: openCmd = 'xdg-open'; break;
                }
                
                return [`${openCmd} "${homepage}" &`];
            }
        };
    }

    static get help() {
        return {
            usage: 'web: true',
            description: 'Opens the project homepage in the default web browser',
            examples: [
                { 
                    config: 'web: true', 
                    description: 'Enable opening project homepage when switching to project' 
                },
                { 
                    config: 'web: false', 
                    description: 'Disable automatic homepage opening' 
                }
            ]
        };
    }
}

module.exports = WebCommand;