const { command } = require('./base');
const inquirer = require('inquirer');
const File = require('phylo');
const Prompt = require('inquirer/lib/prompts/input');
const deepAssign = require('deep-assign');

class init extends command {
    execute (params) {
        let me = this;
        me.log.debug();
        me.log.log(me.root().logo);
        me.log.log();
        let name;
        let fromUser = false;
        if (!params.identifier || params.identifier === 'undefined') {
            me.log.debug('Name was not provided, autodetecting');
            if (me.root().project) {
                me.log.debug('Name derived form current project');
                name = me.root().project;
            } else {
                me.log.debug('Name derived from current working directory')
                name = File.cwd().name;
            }
        } else {
            name = params.identifier;
            fromUser = true;
        }
        return me.startInteractive(name, fromUser);
    }

    startInteractive (defaultName, fromUser, showMain = false) {
        let me = this;
        let environment = me.root().environment;
        me.log.debug(`Name '${defaultName}' was${fromUser ? '' : ' not'} provided by the user`);
        me.log.debug();
        return inquirer.prompt(me._getFirstQuestion(defaultName, fromUser, showMain)).then(function (answers) {
            let questions = [];
            let defaults = me.config.get('project_defaults');
            let projects = me.config.get('projects');
            switch (answers.action) {
                case 'exit':
                    return true;
                case 'more': 
                    return me.startInteractive(defaultName, fromUser, true);
                case 'init-project':
                    return inquirer.prompt([{
                            message: 'What is the name of the project?',
                            default: defaultName,
                            name: 'name',
                            validate: (value) => {
                                if (value in projects) {
                                    return 'Project already exists.';
                                }
                                if (/\w+#\w+/.test(value)) {
                                    let projectName = value.substring(0,value.indexOf('#'));
                                    if (projectName in projects) {
                                        return true;
                                    } else {
                                        return `Project '${projectName}' does not exist. Please create it before starting a branch.`;
                                    }
                                } else {
                                    return true;
                                }
                            },
                            when: (answers) => {
                                if (fromUser) {
                                    answers.name = defaultName;
                                    let prompt = new Prompt({
                                        type: 'input',
                                        name: 'name',
                                        message: `What is the name of the project?`,
                                        status: 'answered',
                                        default: answers.name
                                    });
                                    return me.log.log(prompt.getQuestion());
                                } else {
                                    return true;
                                }
                            }
                        },{
                            message: 'What is the path to the project?',
                            default: (answers) => {
                                if (!/\w+#\w+/.test(answers.name)) {
                                    return File.from(defaults.base).join(answers.name).path
                                }    
                            },
                            when: (answers) => {
                                if (/\w+#\w+/.test(answers.name)) {
                                    let projectName = answers.name.substring(0,answers.name.indexOf('#'));
                                    answers.path = File.from(defaults.base).join(projects[projectName].path).absolutePath();
                                    let prompt = new Prompt({
                                        type: 'input',
                                        message: `What is the path to the project?`,
                                        status: 'answered',
                                        default: answers.path
                                    });
                                    return me.log.log(prompt.getQuestion());
                                } else {
                                    return true;
                                }
                            },
                            name: 'path',
                            filter: (answer) => {
                                let answerFile = File.from(answer);
                                let defaultBase = File.from(defaults.base);
                                if (!answerFile.isAbsolute()) {
                                    answerFile = defaultBase.join(answerFile);
                                }
                                try {
                                    let canonical = answerFile.canonicalize();
                                    if (canonical) {
                                        answerFile = canonical;
                                    } else {
                                        answerFile = answerFile.absolutify();
                                    }
                                } catch (e) {
                                    answerFile = answerFile.absolutify();
                                }
                                return answerFile.relativize(defaultBase.path).path;
                            }
                        },{
                            message: 'What is the IDE?',
                            type: 'list',
                            name: 'ide',
                            choices: [{
                                name: 'Visual Studio Code',
                                value: 'vscode'
                            },{
                                name: 'IntelliJ IDEA',
                                value: 'idea'
                            },{
                                name: 'Atom',
                                value: 'atom'
                            }]
                        },{
                            message: 'Which events should take place when opening?',
                            type: 'checkbox',
                            name: 'events',
                            choices: [{
                                name: 'Change terminal cwd to project path',
                                value: 'cwd'
                            }, {
                                name: 'Open project in IDE',
                                value: 'ide'
                            }],
                            filter: (answer) => {
                                return {
                                    cwd: answer.indexOf('cwd') > -1,
                                    ide: answer.indexOf('ide') > -1
                                }
                            }
                        }]).then((answers) => {
                            let projects = me.config.get('projects');
                            projects[answers.name] = {};
                            deepAssign(projects[answers.name], answers);
                            delete projects[answers.name].name;
                            me.config.set('projects', projects);

                            me.log.info(`Your project has been initialized.`);
                            me.log.info(`Use 'workon ${answers.name}' to start working!`);

                            return true;
                        });
                case 'init-branch':
                    return inquirer.prompt([{
                            message: 'What is the name of the branch?',
                            name: 'branch',
                            validate: (value) => {
                                if (/\w+#\w+/.test(value)) {
                                    return 'Branch name can\'t contain the "#" sign';
                                }
                                if (`${defaultName}#${value}` in projects) {
                                    return 'Branch already exists.';
                                }
                                return true;
                            }
                        }]).then((answers) => {
                            answers.name = `${defaultName}#${answers.branch}`
                            let projects = me.config.get('projects');
                            projects[answers.name] = {};
                            deepAssign(projects[answers.name], answers, projects[defaultName]);
                            delete projects[answers.name].name;
                            me.config.set('projects', projects);

                            me.log.info(`Your project has been initialized.`);
                            me.log.info(`Use 'workon ${answers.name}' to start working!`);

                            return true;
                        });
                case 'switch-project':
                    me.log.info('Switch to an existing project');
                break;
                case 'switch-branch':
                    me.log.info('Switch to an existing branch');
                break;
                case 'manage-projects':
                    me.log.info('Manage existing projects');
                break;
                case 'manage-branches': 
                    me.log.info('Manage existing branches');
                break;
            }
        });
    }

    _getFirstQuestion (defaultName, fromUser, showMain) {
        let me = this;
        let environment = me.root().environment;
        if (!showMain && environment.$isProjectEnvironment && !fromUser) {
            return {
                type: 'list',
                name: 'action',
                message: () => environment.project.name,
                choices: [{
                    name: 'Start a branch',
                    value: 'init-branch'
                },{
                    name: 'Switch branch',
                    value: 'switch-branch'
                },{
                    name: 'Manage branches',
                    value: 'manage-branches'
                },
                new inquirer.Separator(),
                {
                    name: 'More...',
                    value: 'more'
                },{
                    name: 'Exit',
                    value: 'exit'
                }]
            };
        } else {
            return {
                type: 'list',
                name: 'action',
                message: 'What do you want to do?',
                choices: [{
                    name: 'Start a new project',
                    value: 'init-project'
                },{
                    name: 'Open an existing project',
                    value: 'switch-project'
                },{
                    name: 'Manage projects',
                    value: 'manage-projects'
                },
                new inquirer.Separator(),{
                    name: 'Exit',
                    value: 'exit'
                }],
                default: fromUser ? defaultName : undefined,
                when: (answers) => {
                    if (fromUser) {
                        answers.name = 'init-project';
                        let prompt = new Prompt({
                            type: 'input',
                            name: 'name',
                            message: `What do you want to do?`,
                            default: 'Start a new project'
                        });
                        return me.log.log(prompt.getQuestion());
                    }
                    return true;
                }
            };
        }
    }
}

init.define({
    parameters: {
        identifier: {
            type: 'string',
            value: ''
        }
    }
});

module.exports = init;