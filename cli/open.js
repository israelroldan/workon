const { command } = require('./base');
const Project = require('../lib/project');
const { ProjectEnvironment } = require('../lib/environment');
const spawn = require('child_process').spawn;
const File = require('phylo');

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

    processProject (project) {
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
                    me.switchTo(ProjectEnvironment.load(cfg, me.config.get('project_defaults')));
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

    switchTo (environment) {
        let me = this;
        me.root().environment = environment;
        let project = environment.project;

        let events = Object.keys(project.events).filter((e) => project.events[e]);
        me.log.debug(`Shell is ${process.env.SHELL}`);
        me.log.debug(`Project path is ${project.path.path}`);
        me.log.debug(`IDE command is: ${project.ide}`);
        me.log.debug(`Actions are: ${events}`);

        events.forEach(me.processEvent.bind(me));
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
            switch (event) {
                case 'ide':
                    spawn(project.ide, [project.path.path]);
                break;
                case 'cwd':
                    spawn(process.env.SHELL, ['-i'], {
                        cwd: environment.project.path.path,
                        stdio: 'inherit'
                    });
                break;
                case 'web':
                    if (homepage) {
                        require("openurl2").open(homepage);
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
        project: 'The id of the project to open'
    },
    switches: '[d#debug:boolean=false] [n#dry-run:boolean=false]',
    parameters: '[p#project:string]'
});

module.exports = open;