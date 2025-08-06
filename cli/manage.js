const { command } = require('./base');
const inquirer = require('inquirer');
const File = require('phylo');
const ProjectValidator = require('../lib/validation');
const path = require('path');

class manage extends command {
    execute(params) {
        let me = this;
        me.validator = new ProjectValidator(me.config);
        me.showLogo();
        return me.startManagement();
    }

    showLogo() {
        let me = this;
        let version = me.config.get('pkg').version;

        if (!this._hasShownLogo) {
            this.log.log(`                      8\u001b[2m${' '.repeat(Math.max(15-version.length-1, 1))+'v'+version}\u001b[22m\nYb  db  dP .d8b. 8d8b 8.dP \u001b[92m.d8b. 8d8b.\u001b[0m\n YbdPYbdP  8' .8 8P   88b  \u001b[92m8' .8 8P Y8\u001b[0m\n  YP  YP   \`Y8P' 8    8 Yb \u001b[92m\`Y8P' 8   8\u001b[0m`);
            this._hasShownLogo = true;
        }
    }

    async startManagement() {
        let me = this;
        const projects = me.config.get('projects') || {};
        const projectNames = Object.keys(projects);

        const mainMenu = {
            type: 'list',
            name: 'action',
            message: 'Project Management',
            choices: [
                {
                    name: 'Create new project',
                    value: 'create'
                },
                ...(projectNames.length > 0 ? [
                    {
                        name: 'Edit existing project',
                        value: 'edit'
                    },
                    {
                        name: 'Delete project',
                        value: 'delete'
                    },
                    {
                        name: 'List all projects',
                        value: 'list'
                    }
                ] : []),
                new inquirer.Separator(),
                {
                    name: 'Exit',
                    value: 'exit'
                }
            ]
        };

        const answer = await inquirer.prompt([mainMenu]);

        switch (answer.action) {
            case 'create':
                return me.createProject();
            case 'edit':
                return me.editProject();
            case 'delete':
                return me.deleteProject();
            case 'list':
                return me.listProjects();
            case 'exit':
                return;
        }
    }

    async createProject() {
        let me = this;
        const defaults = me.config.get('project_defaults') || {};
        const projects = me.config.get('projects') || {};

        me.log.log('\n🚀 Create New Project\n');

        const questions = [
            {
                type: 'input',
                name: 'name',
                message: 'Project name:',
                default: File.cwd().name,
                validate: (value) => me.validator.validateProjectName(value, projects)
            },
            {
                type: 'input',
                name: 'path',
                message: 'Project path (relative to base directory):',
                default: (answers) => answers.name,
                validate: (value) => {
                    const basePath = defaults.base || process.cwd();
                    return me.validator.validateProjectPath(value, basePath);
                }
            },
            {
                type: 'list',
                name: 'ide',
                message: 'IDE/Editor:',
                choices: [
                    { name: 'Visual Studio Code', value: 'code' },
                    { name: 'IntelliJ IDEA', value: 'idea' },
                    { name: 'Atom', value: 'atom' },
                    { name: 'Sublime Text', value: 'subl' },
                    { name: 'Vim', value: 'vim' },
                    { name: 'Emacs', value: 'emacs' }
                ],
                default: defaults.ide || 'code'
            },
            {
                type: 'input',
                name: 'homepage',
                message: 'Project homepage (optional):',
                validate: (value) => me.validator.validateUrl(value)
            },
            {
                type: 'checkbox',
                name: 'events',
                message: 'Select events to enable:',
                choices: [
                    { name: 'Change directory (cwd)', value: 'cwd', checked: true },
                    { name: 'Open in IDE', value: 'ide', checked: true },
                    { name: 'Open homepage in browser', value: 'web' },
                    { name: 'Launch Claude Code', value: 'claude' }
                ]
            }
        ];

        const answers = await inquirer.prompt(questions);

        // Convert events array to object and configure advanced options
        const events = {};
        for (const event of answers.events) {
            if (event === 'claude') {
                // Ask for Claude-specific configuration
                const claudeConfig = await me.configureClaudeEvent();
                events[event] = claudeConfig;
            } else {
                events[event] = 'true';
            }
        }

        const projectConfig = {
            path: answers.path,
            ide: answers.ide,
            events: events
        };

        if (answers.homepage) {
            projectConfig.homepage = answers.homepage;
        }

        const confirm = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: 'Create this project?',
            default: true
        }]);

        if (confirm.confirmed) {
            projects[answers.name] = projectConfig;
            me.config.set('projects', projects);
            me.log.log(`\n✅ Project '${answers.name}' created successfully!`);
        }

        const continuePrompt = await inquirer.prompt([{
            type: 'confirm',
            name: 'continue',
            message: 'Return to main menu?',
            default: true
        }]);

        if (continuePrompt.continue) {
            return me.startManagement();
        }
    }

    async editProject() {
        let me = this;
        const projects = me.config.get('projects') || {};
        const projectNames = Object.keys(projects);

        if (projectNames.length === 0) {
            me.log.log('No projects found.');
            return me.startManagement();
        }

        const projectChoice = await inquirer.prompt([{
            type: 'list',
            name: 'projectName',
            message: 'Select project to edit:',
            choices: projectNames.map(name => ({
                name: `${name} (${projects[name].path})`,
                value: name
            }))
        }]);

        const project = projects[projectChoice.projectName];
        const currentEvents = Object.keys(project.events || {}).filter(key => project.events[key] === 'true');

        me.log.log(`\n✏️  Edit Project: ${projectChoice.projectName}\n`);

        const questions = [
            {
                type: 'input',
                name: 'path',
                message: 'Project path:',
                default: project.path,
                validate: (value) => {
                    const defaults = me.config.get('project_defaults') || {};
                    const basePath = defaults.base || process.cwd();
                    return me.validator.validateProjectPath(value, basePath);
                }
            },
            {
                type: 'list',
                name: 'ide',
                message: 'IDE/Editor:',
                choices: [
                    { name: 'Visual Studio Code', value: 'code' },
                    { name: 'IntelliJ IDEA', value: 'idea' },
                    { name: 'Atom', value: 'atom' },
                    { name: 'Sublime Text', value: 'subl' },
                    { name: 'Vim', value: 'vim' },
                    { name: 'Emacs', value: 'emacs' }
                ],
                default: project.ide || 'code'
            },
            {
                type: 'input',
                name: 'homepage',
                message: 'Project homepage:',
                default: project.homepage || '',
                validate: (value) => me.validator.validateUrl(value)
            },
            {
                type: 'checkbox',
                name: 'events',
                message: 'Select events to enable:',
                choices: [
                    { name: 'Change directory (cwd)', value: 'cwd', checked: currentEvents.includes('cwd') },
                    { name: 'Open in IDE', value: 'ide', checked: currentEvents.includes('ide') },
                    { name: 'Open homepage in browser', value: 'web', checked: currentEvents.includes('web') },
                    { name: 'Launch Claude Code', value: 'claude', checked: currentEvents.includes('claude') }
                ]
            }
        ];

        const answers = await inquirer.prompt(questions);

        // Convert events array to object and configure advanced options
        const events = {};
        for (const event of answers.events) {
            if (event === 'claude') {
                // If claude was previously configured with advanced options, preserve or update them
                const existingClaudeConfig = project.events && project.events.claude;
                if (existingClaudeConfig && typeof existingClaudeConfig === 'object') {
                    const keepConfig = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'keep',
                        message: 'Keep existing Claude configuration?',
                        default: true
                    }]);
                    
                    if (keepConfig.keep) {
                        events[event] = existingClaudeConfig;
                    } else {
                        events[event] = await me.configureClaudeEvent();
                    }
                } else {
                    events[event] = await me.configureClaudeEvent();
                }
            } else {
                events[event] = 'true';
            }
        }

        const updatedProject = {
            path: answers.path,
            ide: answers.ide,
            events: events
        };

        if (answers.homepage) {
            updatedProject.homepage = answers.homepage;
        }

        const confirm = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: 'Save changes?',
            default: true
        }]);

        if (confirm.confirmed) {
            projects[projectChoice.projectName] = updatedProject;
            me.config.set('projects', projects);
            me.log.log(`\n✅ Project '${projectChoice.projectName}' updated successfully!`);
        }

        const continuePrompt = await inquirer.prompt([{
            type: 'confirm',
            name: 'continue',
            message: 'Return to main menu?',
            default: true
        }]);

        if (continuePrompt.continue) {
            return me.startManagement();
        }
    }

    async deleteProject() {
        let me = this;
        const projects = me.config.get('projects') || {};
        const projectNames = Object.keys(projects);

        if (projectNames.length === 0) {
            me.log.log('No projects found.');
            return me.startManagement();
        }

        const projectChoice = await inquirer.prompt([{
            type: 'list',
            name: 'projectName',
            message: 'Select project to delete:',
            choices: projectNames.map(name => ({
                name: `${name} (${projects[name].path})`,
                value: name
            }))
        }]);

        const confirm = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `Are you sure you want to delete '${projectChoice.projectName}'?`,
            default: false
        }]);

        if (confirm.confirmed) {
            delete projects[projectChoice.projectName];
            me.config.set('projects', projects);
            me.log.log(`\n✅ Project '${projectChoice.projectName}' deleted successfully!`);
        }

        const continuePrompt = await inquirer.prompt([{
            type: 'confirm',
            name: 'continue',
            message: 'Return to main menu?',
            default: true
        }]);

        if (continuePrompt.continue) {
            return me.startManagement();
        }
    }

    async listProjects() {
        let me = this;
        const projects = me.config.get('projects') || {};
        const projectNames = Object.keys(projects);

        if (projectNames.length === 0) {
            me.log.log('No projects found.');
            return me.startManagement();
        }

        me.log.log('\n📋 All Projects:\n');

        projectNames.forEach(name => {
            const project = projects[name];
            const events = Object.keys(project.events || {}).filter(key => project.events[key] === 'true');
            
            me.log.log(`${name}:`);
            me.log.log(`  Path: ${project.path}`);
            me.log.log(`  IDE: ${project.ide}`);
            if (project.homepage) {
                me.log.log(`  Homepage: ${project.homepage}`);
            }
            me.log.log(`  Events: ${events.join(', ') || 'none'}`);
            me.log.log('');
        });

        const continuePrompt = await inquirer.prompt([{
            type: 'confirm',
            name: 'continue',
            message: 'Return to main menu?',
            default: true
        }]);

        if (continuePrompt.continue) {
            return me.startManagement();
        }
    }

    async configureClaudeEvent() {
        let me = this;
        
        me.log.log('\n⚙️  Configure Claude Event\n');
        
        const claudeQuestions = [
            {
                type: 'confirm',
                name: 'useAdvanced',
                message: 'Configure advanced Claude options?',
                default: false
            }
        ];

        const claudeAnswer = await inquirer.prompt(claudeQuestions);
        
        if (!claudeAnswer.useAdvanced) {
            return 'true';
        }

        const advancedQuestions = [
            {
                type: 'input',
                name: 'flags',
                message: 'Claude flags (comma-separated, e.g. --resume,--debug):',
                filter: (input) => {
                    if (!input.trim()) return [];
                    return input.split(',').map(flag => flag.trim()).filter(flag => flag);
                }
            }
        ];

        const advancedAnswers = await inquirer.prompt(advancedQuestions);
        
        const config = {};

        if (advancedAnswers.flags && advancedAnswers.flags.length > 0) {
            config.flags = advancedAnswers.flags;
        }

        return config;
    }
}

manage.define({
    help: 'Interactive project management',
    switches: '[d#debug:boolean=false] [h#help:boolean=false]'
});

module.exports = manage;