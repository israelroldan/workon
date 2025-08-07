# ADR-001: Command-Centric Architecture

**Status:** Implemented  
**Date:** 2025-08-07  
**Deciders:** Israel Roldan  

## Context

The current architecture of the workon CLI has several maintainability issues:

### Current Problems

1. **Scattered Logic**: Command definitions, validation, help text, and processing logic are spread across multiple files
2. **Manual Maintenance**: Hardcoded lists in multiple locations require updates when adding new commands
3. **Tight Coupling**: Adding a new command requires touching 4-6 different files
4. **No Auto-Discovery**: System doesn't automatically detect available commands
5. **Inconsistent Patterns**: Different commands follow different implementation patterns

### Current Architecture Issues

When adding the NPM command, we had to modify:
- `lib/validation.js` - Add to valid events list + validation logic
- `cli/manage.js` - Add to event choices + configuration logic
- `cli/open.js` - Add event processing logic  
- `lib/tmux.js` - Add layout management
- Multiple hardcoded arrays and switch statements

This creates:
- High cognitive load when adding features
- Risk of forgetting to update all locations
- Inconsistent user experience
- Difficult testing and debugging

## Decision

We will refactor to a **Command-Centric Architecture** where each command is self-contained and owns its complete lifecycle.

## Proposed Architecture

### 1. Directory Structure

```
commands/
├── core/                    # Built-in system commands
│   ├── cwd/
│   │   ├── index.js        # Main command class
│   │   ├── processing.js   # Event processing logic
│   │   └── tmux.js        # Tmux integration
│   ├── ide/
│   │   ├── index.js
│   │   ├── validation.js  # IDE validation logic
│   │   └── processing.js
│   └── web/
│       ├── index.js
│       ├── validation.js
│       └── processing.js
├── extensions/              # Feature-rich commands
│   ├── claude/
│   │   ├── index.js
│   │   ├── validation.js   # Claude config validation
│   │   ├── configuration.js # Interactive setup
│   │   ├── processing.js   # Event processing
│   │   └── tmux.js        # Split terminal logic
│   └── npm/
│       ├── index.js
│       ├── validation.js   # NPM config validation
│       ├── configuration.js # Interactive setup
│       ├── processing.js   # Event processing
│       └── tmux.js        # Multi-pane layouts
└── registry.js             # Auto-discovery system
```

### 2. Command Interface

Each command implements a standardized interface:

```javascript
// commands/extensions/npm/index.js
class NPMCommand {
    static metadata = {
        name: 'npm',
        displayName: 'Run NPM command',
        description: 'Execute NPM scripts in project directory',
        category: 'development',
        requiresTmux: true,
        dependencies: ['npm']
    }

    static validation = {
        // Command-specific validation
        validateConfig(config) { /* ... */ }
    }

    static configuration = {
        // Interactive setup prompts
        async configureInteractive() { /* ... */ },
        getDefaultConfig() { /* ... */ }
    }

    static processing = {
        // Event processing
        async processEvent(context) { /* ... */ },
        generateShellCommand(context) { /* ... */ }
    }

    static tmux = {
        // Tmux layout contributions
        getLayoutPriority() { return 10; },
        contributeToLayout(existingCommands) { /* ... */ }
    }

    static help = {
        usage: 'npm: <script-name>',
        examples: [
            { config: 'npm: "dev"', description: 'Run npm run dev' },
            { config: 'npm: { command: "test", watch: true }', description: 'Run tests in watch mode' }
        ]
    }
}
```

### 3. Auto-Discovery System

```javascript
// commands/registry.js
class CommandRegistry {
    static async discoverCommands() {
        // Scan commands/ directory
        // Load command classes
        // Build registry of available commands
    }

    static getValidEventNames() {
        // Auto-generate from discovered commands
    }

    static getCommandByName(name) {
        // Lookup command instance
    }

    static getCommandsForManageUI() {
        // Get display info for interactive management
    }
}
```

### 4. Integration Points

#### Validation System
```javascript
// lib/validation.js (simplified)
class ProjectValidator {
    validateEvents(events) {
        const validCommands = CommandRegistry.getValidEventNames();
        // Delegate to command-specific validation
        for (const [eventName, config] of Object.entries(events)) {
            const command = CommandRegistry.getCommandByName(eventName);
            if (command) {
                const result = command.validation.validateConfig(config);
                if (result !== true) return result;
            }
        }
    }
}
```

#### Interactive Management
```javascript
// cli/manage.js (simplified)
class manage extends command {
    async getEventChoices() {
        return CommandRegistry.getCommandsForManageUI();
    }

    async configureEvent(eventName) {
        const command = CommandRegistry.getCommandByName(eventName);
        return await command.configuration.configureInteractive();
    }
}
```

#### Event Processing
```javascript
// cli/open.js (simplified)
class open extends command {
    async processEvent(eventName, project, context) {
        const command = CommandRegistry.getCommandByName(eventName);
        return await command.processing.processEvent({
            project,
            isShellMode: context.isShellMode,
            shellCommands: context.shellCommands
        });
    }
}
```

### 5. Tmux Layout System

Commands can contribute to tmux layouts with priority-based composition:

```javascript
// Smart layout detection
const enabledCommands = getEnabledCommands(project);
const tmuxContributors = enabledCommands
    .filter(cmd => cmd.tmux)
    .sort((a, b) => b.tmux.getLayoutPriority() - a.tmux.getLayoutPriority());

const layout = tmuxContributors[0].tmux.contributeToLayout(enabledCommands);
```

## Implementation Plan

### Phase 1: Foundation
1. Create `commands/` directory structure
2. Implement `CommandRegistry` with auto-discovery
3. Create base command interface/abstract class
4. Add command loading and registration system

### Phase 2: Core Command Migration
1. Extract `cwd` command to `commands/core/cwd/`
2. Extract `ide` command to `commands/core/ide/`  
3. Extract `web` command to `commands/core/web/`
4. Update validation system to use registry

### Phase 3: Extension Command Migration
1. Extract `claude` command to `commands/extensions/claude/`
2. Extract `npm` command to `commands/extensions/npm/`
3. Update interactive management to use command definitions
4. Update event processing to use command registry

### Phase 4: Enhanced Features
1. Add command dependency checking
2. Implement plugin-like command loading
3. Add command-specific help system
4. Add command testing framework

### Phase 5: Advanced Tmux Integration
1. Implement priority-based layout composition
2. Add layout conflict resolution
3. Add custom layout definitions per command
4. Add layout preview/testing

## Benefits

### For Developers
- **Single Responsibility**: Each command owns its complete lifecycle
- **Easy Testing**: Isolated command logic with clear interfaces
- **Plugin Architecture**: Easy to add/remove commands
- **Better Organization**: Everything related to a command in one place
- **Reduced Coupling**: Commands don't need to know about each other

### For Users
- **Consistent Experience**: All commands follow same patterns
- **Better Help**: Command-specific documentation and examples
- **Auto-Discovery**: New commands automatically available
- **Extensibility**: Easy to add custom commands

### For Maintenance
- **No More Hardcoded Lists**: Commands auto-register themselves
- **Easier Debugging**: Clear command boundaries
- **Simpler Refactoring**: Changes contained within command scope
- **Better Documentation**: Command documentation co-located with code

## Risks and Mitigations

### Risk: Increased Complexity
**Mitigation**: Provide clear base classes and documentation. Start with simple commands.

### Risk: Performance Impact
**Mitigation**: Lazy loading of commands. Cache registry after initial discovery.

### Risk: Breaking Changes
**Mitigation**: Implement alongside existing system. Gradual migration path.

### Risk: Over-Engineering
**Mitigation**: Start simple. Add complexity only when needed. Focus on current pain points.

## Success Criteria

1. Adding a new command requires touching only files in that command's directory
2. Command validation, configuration, and processing logic is co-located
3. Interactive management automatically discovers and presents new commands
4. Tmux layouts compose automatically based on enabled commands
5. Help system provides command-specific guidance
6. Testing can be done per-command with clear interfaces

## Alternative Considered

### Plugin System with External Commands
- **Pros**: Ultimate flexibility, true plugin architecture
- **Cons**: Complexity of plugin loading, versioning, security concerns
- **Decision**: Too complex for current needs. Start with internal command structure.

### Monolithic Command Classes
- **Pros**: Single file per command
- **Cons**: Large files, harder to test specific aspects
- **Decision**: Multi-file approach provides better separation of concerns.

## References

- Current architecture pain points identified during NPM command implementation
- Command pattern design principles
- Plugin architecture best practices
- CLI framework patterns (e.g., Angular CLI, Vue CLI command structures)