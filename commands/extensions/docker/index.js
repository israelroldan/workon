const BaseCommand = require('../../base');
const inquirer = require('inquirer');
const spawn = require('child_process').spawn;

/**
 * Docker Command
 * Manages Docker containers for the project
 * 
 * This demonstrates how easy it is to add a new command to the system!
 * Just create this file and the system automatically discovers it.
 */
class DockerCommand extends BaseCommand {
    static get metadata() {
        return {
            name: 'docker',
            displayName: 'Docker container management',
            description: 'Start/stop Docker containers for the project',
            category: 'development',
            requiresTmux: false,
            dependencies: ['docker']
        };
    }

    static get validation() {
        return {
            validateConfig(config) {
                if (config === true || config === 'true' || config === false || config === 'false') {
                    return true;
                }
                
                if (typeof config === 'string' && config.trim() !== '') {
                    return true; // Docker compose file path
                }
                
                if (typeof config === 'object' && config !== null) {
                    if (config.compose_file && typeof config.compose_file !== 'string') {
                        return 'Docker compose_file must be a string';
                    }
                    if (config.services && !Array.isArray(config.services)) {
                        return 'Docker services must be an array';
                    }
                    return true;
                }
                
                return 'Docker configuration must be a boolean, string, or configuration object';
            }
        };
    }

    static get configuration() {
        return {
            async configureInteractive() {
                console.log('\n🐳 Configure Docker Event\n');
                
                const dockerQuestions = [
                    {
                        type: 'input',
                        name: 'compose_file',
                        message: 'Docker Compose file path (relative to project):',
                        default: 'docker-compose.yml'
                    },
                    {
                        type: 'input',
                        name: 'services',
                        message: 'Services to start (comma-separated, or leave empty for all):',
                        filter: (input) => {
                            if (!input.trim()) return [];
                            return input.split(',').map(s => s.trim()).filter(s => s);
                        }
                    }
                ];

                const answers = await inquirer.prompt(dockerQuestions);
                
                const config = {
                    compose_file: answers.compose_file
                };

                if (answers.services.length > 0) {
                    config.services = answers.services;
                }

                return config;
            },

            getDefaultConfig() {
                return { compose_file: 'docker-compose.yml' };
            }
        };
    }

    static get processing() {
        return {
            async processEvent(context) {
                const { project, isShellMode, shellCommands } = context;
                const dockerConfig = project.events.docker;
                
                let composeFile = 'docker-compose.yml';
                let services = [];
                
                if (typeof dockerConfig === 'string') {
                    composeFile = dockerConfig;
                } else if (dockerConfig && typeof dockerConfig === 'object') {
                    composeFile = dockerConfig.compose_file || composeFile;
                    services = dockerConfig.services || [];
                }
                
                const servicesArg = services.length > 0 ? services.join(' ') : '';
                const dockerCommand = `docker-compose -f ${composeFile} up -d ${servicesArg}`.trim();
                
                if (isShellMode) {
                    shellCommands.push(dockerCommand);
                } else {
                    const args = ['-f', composeFile, 'up', '-d'];
                    if (services.length > 0) {
                        args.push(...services);
                    }
                    spawn('docker-compose', args, {
                        cwd: project.path.path,
                        stdio: 'inherit'
                    });
                }
            },

            generateShellCommand(context) {
                const { project } = context;
                const dockerConfig = project.events.docker;
                
                let composeFile = 'docker-compose.yml';
                let services = [];
                
                if (typeof dockerConfig === 'string') {
                    composeFile = dockerConfig;
                } else if (dockerConfig && typeof dockerConfig === 'object') {
                    composeFile = dockerConfig.compose_file || composeFile;
                    services = dockerConfig.services || [];
                }
                
                const servicesArg = services.length > 0 ? services.join(' ') : '';
                return [`docker-compose -f ${composeFile} up -d ${servicesArg}`.trim()];
            }
        };
    }

    static get help() {
        return {
            usage: 'docker: <compose-file> | <configuration>',
            description: 'Start Docker containers using docker-compose',
            examples: [
                { 
                    config: 'docker: true', 
                    description: 'Start containers using default docker-compose.yml' 
                },
                { 
                    config: 'docker: "docker-compose.dev.yml"', 
                    description: 'Use specific compose file' 
                },
                { 
                    config: 'docker: { compose_file: "docker-compose.yml", services: ["web", "db"] }', 
                    description: 'Start only specific services' 
                }
            ]
        };
    }
}

module.exports = DockerCommand;