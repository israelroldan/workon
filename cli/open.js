const { command } = require('./base');
const Project = require('../lib/project');
const { ProjectEnvironment } = require('../lib/environment');
const spawn = require('child_process').spawn;
const File = require('phylo');
const TmuxManager = require('../lib/tmux');

class open extends command {
    execute (params) {
        let me = this;
        if (params.project) {
            return me.processProject(params.project);
        } else {
            me.log.debug(`No project name provided, starting interactive mode`);
            return me.startInteractiveMode();
        }
    }

    async processProject (project) {
        let me = this;
        let environment = me.root().environment;

        let projects = me.config.get('projects');
        if (!projects) {
            me.config.set('projects', {});
        } else {
            if (environment.$isProjectEnvironment && (project === 'this' || project === '.')) {
                me.log.info(`Open current: ${environment.project.name}`);
            } else {
                if (project in projects) {
                    let cfg = projects[project];
                    cfg.name = project;
                    await me.switchTo(ProjectEnvironment.load(cfg, me.config.get('project_defaults')));
                } else {
                    me.log.debug(`Project '${project}' not found, starting interactive mode`);
                    return me.startInteractiveMode(project);
                }
            }
        }
    }

    startInteractiveMode (project) {
        let me = this;
        let root = me.root();
        
        let interactiveCmd = root.commands.lookup('interactive').create(root);
        return interactiveCmd.dispatch(new me.args.constructor([project]))
    }

    async switchTo (environment) {
        let me = this;
        me.root().environment = environment;
        let project = environment.project;

        let events = Object.keys(project.events).filter((e) => project.events[e]);
        me.log.debug(`Shell is ${process.env.SHELL}`);
        me.log.debug(`Project path is ${project.path.path}`);
        me.log.debug(`IDE command is: ${project.ide}`);
        me.log.debug(`Actions are: ${events}`);

        // Initialize shell commands collector if in shell mode
        let isShellMode = me.params.shell || me.root().params.shell;
        if (isShellMode) {
            me.shellCommands = [];
        }

        // Check for split terminal scenario
        const hasCwd = events.includes('cwd');
        const hasClaudeEvent = events.includes('claude');
        const claudeConfig = project.events.claude;
        const shouldUseSplitTerminal = hasCwd && hasClaudeEvent && 
            claudeConfig && typeof claudeConfig === 'object' && claudeConfig.split_terminal;

        if (shouldUseSplitTerminal) {
            await me.handleSplitTerminal(project, isShellMode);
            // Process other events except cwd and claude
            events.filter(e => e !== 'cwd' && e !== 'claude').forEach(me.processEvent.bind(me));
        } else {
            // Normal event processing
            events.forEach(me.processEvent.bind(me));
        }

        // Output collected shell commands if in shell mode
        if (isShellMode && me.shellCommands.length > 0) {
            console.log(me.shellCommands.join('\n'));
        }
    }

    async handleSplitTerminal(project, isShellMode) {
        let me = this;
        const tmux = new TmuxManager();
        const claudeConfig = project.events.claude;
        const claudeArgs = (claudeConfig && claudeConfig.flags) ? claudeConfig.flags : [];
        
        if (isShellMode) {
            // Check if tmux is available
            if (await tmux.isTmuxAvailable()) {
                const commands = tmux.buildShellCommands(
                    project.name, 
                    project.path.path, 
                    claudeArgs
                );
                me.shellCommands.push(...commands);
            } else {
                // Fall back to normal behavior if tmux is not available
                me.log.debug('Tmux not available, falling back to normal mode');
                me.shellCommands.push(`cd "${project.path.path}"`);
                const claudeCommand = claudeArgs.length > 0 
                    ? `claude ${claudeArgs.join(' ')}`
                    : 'claude';
                me.shellCommands.push(claudeCommand);
            }
        } else {
            // Direct execution mode
            if (await tmux.isTmuxAvailable()) {
                try {
                    const sessionName = await tmux.createSplitSession(
                        project.name, 
                        project.path.path, 
                        claudeArgs
                    );
                    await tmux.attachToSession(sessionName);
                } catch (error) {
                    me.log.debug(`Failed to create tmux session: ${error.message}`);
                    // Fall back to normal behavior
                    me.processEvent('cwd');
                    me.processEvent('claude');
                }
            } else {
                me.log.debug('Tmux not available, falling back to normal mode');
                // Fall back to normal behavior
                me.processEvent('cwd');
                me.processEvent('claude');
            }
        }
    }

    processEvent (event) {
        let me = this;
        let environment = me.root().environment;
        let project = environment.project;
        let scripts = project.scripts || {};
        let homepage = project.homepage;
        let capitalEvt = `${event[0].toUpperCase()}${event.substring(1)}`;

        me.log.debug(`Processing event ${event}`);
        if (`before${capitalEvt}` in scripts) {
            me.log.debug(`Found 'before' script, unfortunately scripts are not yet supported.`);
        }
        if (event in scripts) {
            me.log.debug(`Found script with event name, unfortunately scripts are not yet supported.`);
        }
        if (!me.params['dry-run']) {
            // Check if we're in shell mode
            let isShellMode = me.params.shell || me.root().params.shell;
            me.log.debug(`Shell mode is: ${isShellMode}`);
            
            switch (event) {
                case 'ide':
                    if (isShellMode) {
                        me.shellCommands.push(`${project.ide} "${project.path.path}" &`);
                    } else {
                        spawn(project.ide, [project.path.path]);
                    }
                break;
                case 'cwd':
                    if (isShellMode) {
                        me.shellCommands.push(`cd "${environment.project.path.path}"`);
                    } else {
                        spawn(process.env.SHELL, ['-i'], {
                            cwd: environment.project.path.path,
                            stdio: 'inherit'
                        });
                    }
                break;
                case 'web':
                    if (homepage) {
                        if (isShellMode) {
                            // Different approaches based on OS
                            let openCmd;
                            switch (process.platform) {
                                case 'darwin': openCmd = 'open'; break;
                                case 'win32': openCmd = 'start'; break;
                                default: openCmd = 'xdg-open'; break;
                            }
                            me.shellCommands.push(`${openCmd} "${homepage}" &`);
                        } else {
                            require("openurl2").open(homepage);
                        }
                    }
                break;
                case 'claude':
                    let claudeArgs = [];
                    let claudeConfig = project.events.claude;
                    
                    // Handle advanced Claude configuration
                    if (claudeConfig && typeof claudeConfig === 'object') {
                        if (claudeConfig.flags && Array.isArray(claudeConfig.flags)) {
                            claudeArgs = claudeArgs.concat(claudeConfig.flags);
                        }
                        // Additional config options can be handled here in the future
                    }
                    
                    if (isShellMode) {
                        let claudeCommand = claudeArgs.length > 0 
                            ? `claude ${claudeArgs.join(' ')}`
                            : 'claude';
                        me.shellCommands.push(claudeCommand);
                    } else {
                        spawn('claude', claudeArgs, {
                            cwd: environment.project.path.path,
                            stdio: 'inherit'
                        });
                    }
                break;
            }
        }
        if (`before${capitalEvt}` in scripts) {
            me.log.debug(`Found 'after' script, unfortunately scripts are not yet supported.`);
        }
    }
}

open.define({
    help: {
        '': 'open a project by passing its project id',
        project: 'The id of the project to open',
        shell: 'Output shell commands instead of spawning processes'
    },
    switches: '[d#debug:boolean=false] [n#dry-run:boolean=false] [shell:boolean=false]',
    parameters: '[p#project:string]'
});

module.exports = open;