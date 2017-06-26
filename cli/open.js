const { command } = require('./base');
const Project = require('../lib/project');
const { ProjectEnvironment } = require('../lib/environment');
const spawn = require('child_process').spawn;
const File = require('phylo');

class open extends command {
    execute (params, args) {
        let me = this;
        let defaults = me.config.get('project_defaults');
        let baseDir = File.from(defaults.base);
        let projects = me.config.get('projects');
        let cwp = null;
        switch (params.identifier) {
            case undefined:
                me.log.debug(`No project name provided, starting interactive mode`);
                return me.startInteractiveMode();
            default:
                return me.processProjectIdentifier(params.identifier);
        }
    }

    processProjectIdentifier (identifier) {
        let me = this;
        let environment = me.root().environment;

        let projects = me.config.get('projects');
        if (!projects) {
            me.config.set('projects', {});
        } else {
            if (environment.$isProjectEnvironment && (identifier === 'this' || identifier === '.')) {
                me.log.info(`Open current: ${environment.project.name}`);
            } else {
                if (identifier in projects) {   
                    let cfg = projects[identifier];
                    cfg.name = identifier;
                    me.switchTo(ProjectEnvironment.load(cfg, me.config.get('project_defaults')));
                } else {
                    me.log.debug(`Project '${identifier}' not found, starting interactive mode`);
                    return me.startInteractiveMode(identifier);
                }
            }
        }
    }

    startInteractiveMode (identifier) {
        let me = this;
        let root = me.root();
        
        let interactiveCmd = root.commands.lookup('interactive').create(root);
        return interactiveCmd.dispatch(new me.args.constructor([identifier]))
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
        if (`before${capitalEvt}` in scripts) {
            me.log.debug(`Found 'after' script, unfortunately scripts are not yet supported.`);
        }
    }
}

open.define({
    switches: '[debug:boolean=false]',
    parameters: '[identifier:string]'
});

module.exports = open;