const File = require('phylo');
const { spawn } = require('child_process');
const path = require('path');

class ProjectValidator {
    constructor(config) {
        this.config = config;
    }

    validateProjectName(name, existingProjects = {}) {
        if (!name || name.trim() === '') {
            return 'Project name cannot be empty';
        }
        
        if (name in existingProjects) {
            return 'Project already exists';
        }
        
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            return 'Project name can only contain letters, numbers, underscores, and hyphens';
        }
        
        return true;
    }

    validateProjectPath(projectPath, basePath) {
        if (!projectPath || projectPath.trim() === '') {
            return 'Project path cannot be empty';
        }
        
        const fullPath = basePath ? path.resolve(basePath, projectPath) : path.resolve(projectPath);
        
        try {
            const fileObj = new File(fullPath);
            if (!fileObj.exists) {
                return `Directory does not exist: ${fullPath}`;
            }
            if (!fileObj.isDirectory) {
                return `Path is not a directory: ${fullPath}`;
            }
        } catch (error) {
            return `Invalid path: ${error.message}`;
        }
        
        return true;
    }

    validateIdeCommand(ideCommand) {
        if (!ideCommand || ideCommand.trim() === '') {
            return 'IDE command cannot be empty';
        }

        const validIdeCommands = ['code', 'idea', 'atom', 'subl', 'vim', 'emacs'];
        if (!validIdeCommands.includes(ideCommand)) {
            return `Unknown IDE command. Supported: ${validIdeCommands.join(', ')}`;
        }

        return true;
    }

    async validateIdeAvailability(ideCommand) {
        return new Promise((resolve) => {
            const child = spawn('which', [ideCommand], { stdio: 'pipe' });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    resolve(`IDE command '${ideCommand}' not found in PATH`);
                }
            });
            child.on('error', () => {
                resolve(`Could not check if '${ideCommand}' is available`);
            });
        });
    }

    validateEvents(events) {
        if (!events || typeof events !== 'object') {
            return 'Events must be an object';
        }

        const validEvents = ['cwd', 'ide', 'web', 'claude', 'npm'];
        const invalidEvents = Object.keys(events).filter(event => !validEvents.includes(event));
        
        if (invalidEvents.length > 0) {
            return `Invalid events: ${invalidEvents.join(', ')}. Valid events: ${validEvents.join(', ')}`;
        }

        // Validate claude event configuration if present
        if (events.claude && typeof events.claude === 'object') {
            const claudeValidation = this.validateClaudeConfig(events.claude);
            if (claudeValidation !== true) {
                return claudeValidation;
            }
        }

        // Validate npm event configuration if present
        if (events.npm && typeof events.npm === 'object') {
            const npmValidation = this.validateNpmConfig(events.npm);
            if (npmValidation !== true) {
                return npmValidation;
            }
        }

        return true;
    }

    validateClaudeConfig(config) {
        if (typeof config !== 'object') {
            return 'Claude configuration must be an object';
        }

        // Validate flags if present
        if (config.flags) {
            if (!Array.isArray(config.flags)) {
                return 'Claude flags must be an array';
            }
            
            // Basic flag validation - ensure they start with - or --
            const invalidFlags = config.flags.filter(flag => 
                typeof flag !== 'string' || (!flag.startsWith('-') && !flag.startsWith('--'))
            );
            
            if (invalidFlags.length > 0) {
                return `Invalid Claude flags: ${invalidFlags.join(', ')}. Flags must start with - or --`;
            }
        }

        // Validate split_terminal if present
        if (config.split_terminal !== undefined && typeof config.split_terminal !== 'boolean') {
            return 'Claude split_terminal must be a boolean';
        }

        return true;
    }

    validateNpmConfig(config) {
        if (typeof config !== 'object') {
            return 'NPM configuration must be an object';
        }

        // Validate command if present
        if (config.command) {
            if (typeof config.command !== 'string' || config.command.trim() === '') {
                return 'NPM command must be a non-empty string';
            }
        }

        // Validate watch if present
        if (config.watch !== undefined && typeof config.watch !== 'boolean') {
            return 'NPM watch must be a boolean';
        }

        // Validate auto_restart if present
        if (config.auto_restart !== undefined && typeof config.auto_restart !== 'boolean') {
            return 'NPM auto_restart must be a boolean';
        }

        return true;
    }

    validateUrl(url) {
        if (!url) return true; // Optional field
        
        try {
            new URL(url);
            return true;
        } catch {
            return 'Invalid URL format';
        }
    }
}

module.exports = ProjectValidator;