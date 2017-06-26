const Environment = require('./base');
const Project = require('../project');

class ProjectEnvironment extends Environment {
    static load (project, defaults) {
        let environment = new ProjectEnvironment(project, defaults);
        return environment;
    }
    //------------------------------
    constructor (config, defaults) {
        if (config.$isProject) {
            super({
                project: config
            });
        } else {
            super({
                project: new Project(config.name, config, defaults)
            });
        }
    }
}

ProjectEnvironment.$isProjectEnvironment = true;
ProjectEnvironment.prototype.$isProjectEnvironment = true;

module.exports = ProjectEnvironment;