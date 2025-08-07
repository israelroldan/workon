const { command } = require('./base');
const Project = require('../lib/project');
const { ProjectEnvironment } = require('../lib/environment');
const spawn = require('child_process').spawn;
const File = require('phylo');
const TmuxManager = require('../lib/tmux');
const registry = require('../commands/registry');

class open extends command {
    async execute (params) {
        let me = this;
        
        // Initialize command registry
        await registry.initialize();
        
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

        // Intelligent layout detection
        const hasCwd = events.includes('cwd');
        const hasClaudeEvent = events.includes('claude');
        const hasNpmEvent = events.includes('npm');
        
        if (hasCwd && hasClaudeEvent && hasNpmEvent) {
            // Three-pane layout: Claude + Terminal + NPM
            await me.handleThreePaneLayout(project, isShellMode);
            // Process other events except cwd, claude, and npm
            for (const event of events.filter(e => !['cwd', 'claude', 'npm'].includes(e))) {
                await me.processEvent(event);
            }
        } else if (hasCwd && hasNpmEvent) {
            // Two-pane layout: Terminal + NPM (no Claude)
            await me.handleTwoPaneNpmLayout(project, isShellMode);
            // Process other events except cwd and npm
            for (const event of events.filter(e => !['cwd', 'npm'].includes(e))) {
                await me.processEvent(event);
            }
        } else if (hasCwd && hasClaudeEvent) {
            // Two-pane layout: Claude + Terminal (existing split terminal)
            await me.handleSplitTerminal(project, isShellMode);
            // Process other events except cwd and claude
            for (const event of events.filter(e => !['cwd', 'claude'].includes(e))) {
                await me.processEvent(event);
            }
        } else {
            // Normal event processing
            for (const event of events) {
                await me.processEvent(event);
            }
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
                    await me.processEvent('cwd');
                    await me.processEvent('claude');
                }
            } else {
                me.log.debug('Tmux not available, falling back to normal mode');
                // Fall back to normal behavior
                await me.processEvent('cwd');
                await me.processEvent('claude');
            }
        }
    }

    async handleThreePaneLayout(project, isShellMode) {
        let me = this;
        const tmux = new TmuxManager();
        const claudeConfig = project.events.claude;
        const claudeArgs = (claudeConfig && claudeConfig.flags) ? claudeConfig.flags : [];
        const npmConfig = project.events.npm;
        const NpmCommand = registry.getCommandByName('npm');
        const npmCommand = NpmCommand ? NpmCommand._getNpmCommand(npmConfig) : 'npm run dev';
        
        if (isShellMode) {
            // Check if tmux is available
            if (await tmux.isTmuxAvailable()) {
                const commands = tmux.buildThreePaneShellCommands(
                    project.name, 
                    project.path.path, 
                    claudeArgs,
                    npmCommand
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
                me.shellCommands.push(npmCommand);
            }
        } else {
            // Direct execution mode
            if (await tmux.isTmuxAvailable()) {
                try {
                    const sessionName = await tmux.createThreePaneSession(
                        project.name, 
                        project.path.path, 
                        claudeArgs,
                        npmCommand
                    );
                    await tmux.attachToSession(sessionName);
                } catch (error) {
                    me.log.debug(`Failed to create tmux session: ${error.message}`);
                    // Fall back to normal behavior
                    await me.processEvent('cwd');
                    await me.processEvent('claude');
                    await me.processEvent('npm');
                }
            } else {
                me.log.debug('Tmux not available, falling back to normal mode');
                // Fall back to normal behavior
                await me.processEvent('cwd');
                await me.processEvent('claude');
                await me.processEvent('npm');
            }
        }
    }

    async handleTwoPaneNpmLayout(project, isShellMode) {
        let me = this;
        const tmux = new TmuxManager();
        const npmConfig = project.events.npm;
        const NpmCommand = registry.getCommandByName('npm');
        const npmCommand = NpmCommand ? NpmCommand._getNpmCommand(npmConfig) : 'npm run dev';
        
        if (isShellMode) {
            // Check if tmux is available
            if (await tmux.isTmuxAvailable()) {
                const commands = tmux.buildTwoPaneNpmShellCommands(
                    project.name, 
                    project.path.path, 
                    npmCommand
                );
                me.shellCommands.push(...commands);
            } else {
                // Fall back to normal behavior if tmux is not available
                me.log.debug('Tmux not available, falling back to normal mode');
                me.shellCommands.push(`cd "${project.path.path}"`);
                me.shellCommands.push(npmCommand);
            }
        } else {
            // Direct execution mode
            if (await tmux.isTmuxAvailable()) {
                try {
                    const sessionName = await tmux.createTwoPaneNpmSession(
                        project.name, 
                        project.path.path, 
                        npmCommand
                    );
                    await tmux.attachToSession(sessionName);
                } catch (error) {
                    me.log.debug(`Failed to create tmux session: ${error.message}`);
                    // Fall back to normal behavior
                    await me.processEvent('cwd');
                    await me.processEvent('npm');
                }
            } else {
                me.log.debug('Tmux not available, falling back to normal mode');
                // Fall back to normal behavior
                await me.processEvent('cwd');
                await me.processEvent('npm');
            }
        }
    }


    async processEvent (event) {
        let me = this;
        let environment = me.root().environment;
        let project = environment.project;
        let scripts = project.scripts || {};
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
            
            // Use CommandRegistry to process the event
            const command = registry.getCommandByName(event);
            if (command && command.processing) {
                await command.processing.processEvent({
                    project,
                    isShellMode,
                    shellCommands: me.shellCommands || []
                });
            } else {
                me.log.debug(`No command handler found for event: ${event}`);
            }
        }
        if (`after${capitalEvt}` in scripts) {
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