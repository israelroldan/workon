const Environment = require('./base');
const ProjectEnvironment = require('./project');
const Config = require('../config');
const File = require('phylo');
const loog = require('loog');
const git = require('simple-git');

class EnvironmentRecognizer {
    static configure (config, log) {
        let me = this;
        if (me.$$configured) {
            return;
        }
        if (!config) {
            config = new Config();
        }
        me.config = config;

        if (!log) {
            log = loog({
                prefixStyle: 'ascii'
            });
        }
        me.log = log;
        me.$$configured = true;
    }

    static recognize (dir) {
        let me = this;
        me.configure();
        
        return new Promise((resolve, reject) => {
            try {
                let theDir = File.from(dir).canonicalize();
                me.log.debug('Directory to recognize is: ' + theDir.canonicalPath());
                let allProjects = me._getAllProjects();
                let matching = allProjects.filter((p) => p.path.canonicalPath() === theDir.path);
                if (matching.length > 0) {
                    me.log.debug(`Found ${matching.length} matching projects`);
                    let base = matching.filter((p) => !~p.name.indexOf('#'))[0];
                    me.log.debug('Base project is: ' + base.name);

                    base.matching = matching;
                    let gitDir = base.path.up('.git');
                    if (gitDir) {
                        git(gitDir.path).branchLocal((error, summary) => {
                            base.branch = summary.current;
                            me._getProjectEnvironment(base, resolve, reject);
                        });
                    } else {
                        me._getProjectEnvironment(base, resolve, reject);
                    }
                } else {
                    resolve(new Environment());
                }
            } catch (ex) {
                reject(ex);
            }         
        });
    }

    static _getAllProjects (refresh) {
        let me = this;
        let allProjects = me.projects;
        if (!allProjects || refresh) {
            let defaults = me.config.get('project_defaults');
            let baseDir = File.from(defaults.base);
            let projectsMap = me.config.get('projects');
            allProjects = [];
            for (let name in projectsMap) {
                let project = projectsMap[name];
                project.name = name;
                project.path = baseDir.join(project.path);
                allProjects.push(project);
            }
            me.projects = allProjects;
        }
        return allProjects;
    }

    static _getProjectEnvironment(base, resolve, reject) {
        let me = this;
        let projectCfg = base;
        let exactName = `${base.name}#${base.branch}`;
        try {
            let exactProj = me.projects.filter((p) => p.name === exactName)[0];
            if (exactProj) {
                projectCfg = exactProj;
            }
            projectCfg.exactName = exactName;
            resolve(new ProjectEnvironment(projectCfg));
        } catch (ex) {
            reject(ex);
        }
    }
}

module.exports = {
    ProjectEnvironment,
    EnvironmentRecognizer
}