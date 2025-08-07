/**
 * Base command interface that all commands must implement
 * Provides standardized structure for command-centric architecture
 */
class BaseCommand {
    /**
     * Command metadata - must be implemented by each command
     * @returns {Object} metadata object with name, displayName, description, etc.
     */
    static get metadata() {
        throw new Error('Command must implement static metadata getter');
    }

    /**
     * Validation rules for command configuration
     * @returns {Object} validation methods
     */
    static get validation() {
        return {
            /**
             * Validate command-specific configuration
             * @param {*} config - Configuration to validate
             * @returns {true|string} true if valid, error message if invalid
             */
            validateConfig(config) {
                return true; // Default: accept any config
            }
        };
    }

    /**
     * Interactive configuration setup
     * @returns {Object} configuration methods
     */
    static get configuration() {
        return {
            /**
             * Interactive setup prompts for the command
             * @returns {*} Configuration object or primitive value
             */
            async configureInteractive() {
                return 'true'; // Default: simple boolean enable
            },

            /**
             * Get default configuration for the command
             * @returns {*} Default configuration
             */
            getDefaultConfig() {
                return 'true';
            }
        };
    }

    /**
     * Event processing logic
     * @returns {Object} processing methods
     */
    static get processing() {
        return {
            /**
             * Process the command event
             * @param {Object} context - Processing context
             * @param {Object} context.project - Project configuration
             * @param {boolean} context.isShellMode - Whether in shell mode
             * @param {string[]} context.shellCommands - Array to collect shell commands
             * @returns {Promise<void>}
             */
            async processEvent(context) {
                throw new Error('Command must implement processEvent method');
            },

            /**
             * Generate shell command for the event
             * @param {Object} context - Processing context
             * @returns {string[]} Array of shell commands
             */
            generateShellCommand(context) {
                return [];
            }
        };
    }

    /**
     * Tmux integration (optional)
     * @returns {Object|null} tmux methods or null if not supported
     */
    static get tmux() {
        return null; // Default: no tmux integration
    }

    /**
     * Help and documentation
     * @returns {Object} help information
     */
    static get help() {
        return {
            usage: `${this.metadata.name}: <configuration>`,
            description: this.metadata.description,
            examples: []
        };
    }
}

module.exports = BaseCommand;