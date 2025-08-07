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

    async processProject (projectParam) {
        let me = this;
        let environment = me.root().environment;

        // Parse colon syntax: project:command1,command2
        const [projectName, commandsString] = projectParam.split(':');
        const requestedCommands = commandsString ? commandsString.split(',').map(cmd => cmd.trim()) : null;
        
        // Special case: project:help shows available commands for that project
        if (commandsString === 'help') {
            return me.showProjectHelp(projectName);
        }
        
        me.log.debug(`Project: ${projectName}, Commands: ${requestedCommands ? requestedCommands.join(', ') : 'all'}`);

        let projects = me.config.get('projects');
        if (!projects) {
            me.config.set('projects', {});
        } else {
            if (environment.$isProjectEnvironment && (projectName === 'this' || projectName === '.')) {
                me.log.info(`Open current: ${environment.project.name}`);
            } else {
                if (projectName in projects) {
                    let cfg = projects[projectName];
                    cfg.name = projectName;
                    
                    // Validate requested commands if specified
                    if (requestedCommands) {
                        me.validateRequestedCommands(requestedCommands, cfg, projectName);
                    }
                    
                    const projectEnv = ProjectEnvironment.load(cfg, me.config.get('project_defaults'));
                    await me.switchTo(projectEnv, requestedCommands);
                } else {
                    me.log.debug(`Project '${projectName}' not found, starting interactive mode`);
                    return me.startInteractiveMode(projectName);
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

    validateRequestedCommands(requestedCommands, projectConfig, projectName) {
        const configuredEvents = Object.keys(projectConfig.events || {});
        const invalidCommands = requestedCommands.filter(cmd => !configuredEvents.includes(cmd));
        
        if (invalidCommands.length > 0) {
            const availableCommands = configuredEvents.join(', ');
            throw new Error(
                `Commands not configured for project '${projectName}': ${invalidCommands.join(', ')}\n` +
                `Available commands: ${availableCommands}`
            );
        }
    }

    async switchTo (environment, requestedCommands = null) {
        let me = this;
        me.root().environment = environment;
        let project = environment.project;

        // Determine which events to execute
        let events;
        if (requestedCommands) {
            // Use requested commands (already validated)
            events = me.resolveCommandDependencies(requestedCommands, project);
            me.log.debug(`Executing requested commands: ${events.join(', ')}`);
        } else {
            // Execute all configured events (current behavior)
            events = Object.keys(project.events).filter((e) => project.events[e]);
            me.log.debug(`Executing all configured commands: ${events.join(', ')}`);
        }

        me.log.debug(`Shell is ${process.env.SHELL}`);
        me.log.debug(`Project path is ${project.path.path}`);
        me.log.debug(`IDE command is: ${project.ide}`);
        me.log.debug(`Final events to execute: ${events.join(', ')}`);

        // Initialize shell commands collector if in shell mode
        let isShellMode = me.params.shell || me.root().params.shell;
        if (isShellMode) {
            me.shellCommands = [];
        }

        // Intelligent layout detection based on actual events being executed
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
            // Normal event processing - execute commands individually
            for (const event of events) {
                await me.processEvent(event);
            }
        }

        // Output collected shell commands if in shell mode
        if (isShellMode && me.shellCommands.length > 0) {
            console.log(me.shellCommands.join('\n'));
        }
    }

    showProjectHelp(projectName) {
        let me = this;
        let projects = me.config.get('projects');
        
        if (!projects || !(projectName in projects)) {
            me.log.error(`Project '${projectName}' not found`);
            return;
        }
        
        const projectConfig = projects[projectName];
        const configuredEvents = Object.keys(projectConfig.events || {});
        
        console.log(`\n📋 Available commands for '${projectName}':`);
        console.log('─'.repeat(50));
        
        for (const eventName of configuredEvents) {
            const command = registry.getCommandByName(eventName);
            if (command && command.metadata) {
                const config = projectConfig.events[eventName];
                let configDesc = '';
                if (config !== true && config !== 'true') {
                    if (typeof config === 'object') {
                        configDesc = ` (${JSON.stringify(config)})`;
                    } else {
                        configDesc = ` (${config})`;
                    }
                }
                console.log(`  ${eventName.padEnd(8)} - ${command.metadata.description}${configDesc}`);
            }
        }
        
        console.log('\n💡 Usage examples:');
        console.log(`  workon ${projectName}                    # Execute all commands`);
        console.log(`  workon ${projectName}:cwd               # Just change directory`);
        console.log(`  workon ${projectName}:claude            # Just Claude (auto-adds cwd)`);
        
        if (configuredEvents.length > 1) {
            const twoCommands = configuredEvents.slice(0, 2).join(',');
            console.log(`  workon ${projectName}:${twoCommands.padEnd(12)} # Multiple commands`);
        }
        
        console.log(`  workon ${projectName}:cwd --shell       # Output shell commands\n`);
    }

    resolveCommandDependencies(requestedCommands, project) {
        const resolved = [...requestedCommands];
        
        // Auto-add cwd dependency for commands that need it
        const needsCwd = ['claude', 'npm', 'ide'];
        const needsCwdCommands = requestedCommands.filter(cmd => needsCwd.includes(cmd));
        
        if (needsCwdCommands.length > 0 && !requestedCommands.includes('cwd')) {
            resolved.unshift('cwd'); // Add cwd at the beginning
            this.log.debug(`Auto-added 'cwd' dependency for commands: ${needsCwdCommands.join(', ')}`);
        }
        
        // Remove duplicates while preserving order
        return [...new Set(resolved)];
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