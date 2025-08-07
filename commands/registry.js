const fs = require('fs');
const path = require('path');

/**
 * Command Registry for auto-discovery and management of commands
 * Scans the commands directory and provides unified access to all commands
 */
class CommandRegistry {
    constructor() {
        this._commands = new Map();
        this._initialized = false;
    }

    /**
     * Initialize the registry by discovering all commands
     */
    async initialize() {
        if (this._initialized) return;

        await this._discoverCommands();
        this._initialized = true;
    }

    /**
     * Discover commands from the commands directory
     * @private
     */
    async _discoverCommands() {
        const commandsDir = path.join(__dirname);
        
        // Discover core commands
        await this._discoverCommandsInDirectory(path.join(commandsDir, 'core'));
        
        // Discover extension commands
        await this._discoverCommandsInDirectory(path.join(commandsDir, 'extensions'));
    }

    /**
     * Discover commands in a specific directory
     * @param {string} dir - Directory to scan
     * @private
     */
    async _discoverCommandsInDirectory(dir) {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const commandDir = path.join(dir, entry.name);
                const indexFile = path.join(commandDir, 'index.js');
                
                if (fs.existsSync(indexFile)) {
                    try {
                        const CommandClass = require(indexFile);
                        
                        // Validate command structure
                        if (this._isValidCommand(CommandClass)) {
                            const metadata = CommandClass.metadata;
                            this._commands.set(metadata.name, CommandClass);
                        } else {
                            console.error(`Invalid command structure in ${indexFile}`);
                        }
                    } catch (error) {
                        console.error(`Failed to load command from ${indexFile}:`, error.message);
                    }
                }
            }
        }
    }

    /**
     * Validate if a class is a proper command
     * @param {Function} CommandClass - Command class to validate
     * @returns {boolean}
     * @private
     */
    _isValidCommand(CommandClass) {
        try {
            // Check if it has required static properties
            const metadata = CommandClass.metadata;
            return metadata && 
                   typeof metadata.name === 'string' && 
                   typeof metadata.displayName === 'string' &&
                   typeof CommandClass.validation === 'object' &&
                   typeof CommandClass.configuration === 'object' &&
                   typeof CommandClass.processing === 'object';
        } catch (error) {
            return false;
        }
    }

    /**
     * Get all valid event names from discovered commands
     * @returns {string[]}
     */
    getValidEventNames() {
        this._ensureInitialized();
        return Array.from(this._commands.keys());
    }

    /**
     * Get command by name
     * @param {string} name - Command name
     * @returns {Function|null} Command class or null if not found
     */
    getCommandByName(name) {
        this._ensureInitialized();
        return this._commands.get(name) || null;
    }

    /**
     * Get all commands for management UI
     * @returns {Array<Object>} Array of command info objects
     */
    getCommandsForManageUI() {
        this._ensureInitialized();
        
        const commands = [];
        for (const [name, CommandClass] of this._commands) {
            const metadata = CommandClass.metadata;
            commands.push({
                name: metadata.displayName,
                value: name,
                description: metadata.description
            });
        }
        
        return commands.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get commands that support tmux integration
     * @returns {Array<Object>} Array of commands with tmux support
     */
    getTmuxEnabledCommands() {
        this._ensureInitialized();
        
        const tmuxCommands = [];
        for (const [name, CommandClass] of this._commands) {
            if (CommandClass.tmux) {
                tmuxCommands.push({
                    name,
                    command: CommandClass,
                    priority: CommandClass.tmux.getLayoutPriority ? CommandClass.tmux.getLayoutPriority() : 0
                });
            }
        }
        
        return tmuxCommands.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get all available commands with their metadata
     * @returns {Array<Object>} Array of command metadata
     */
    getAllCommands() {
        this._ensureInitialized();
        
        const commands = [];
        for (const [name, CommandClass] of this._commands) {
            commands.push({
                name,
                metadata: CommandClass.metadata,
                hasValidation: !!CommandClass.validation,
                hasConfiguration: !!CommandClass.configuration,
                hasProcessing: !!CommandClass.processing,
                hasTmux: !!CommandClass.tmux,
                hasHelp: !!CommandClass.help
            });
        }
        
        return commands;
    }

    /**
     * Ensure registry is initialized
     * @private
     */
    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error('CommandRegistry must be initialized before use. Call initialize() first.');
        }
    }

    /**
     * Clear the registry (useful for testing)
     */
    clear() {
        this._commands.clear();
        this._initialized = false;
    }
}

// Export singleton instance
module.exports = new CommandRegistry();