# ADR-002: Positional Command Arguments

**Status:** Proposed  
**Date:** 2025-08-06  
**Deciders:** Israel Roldan  
**Related:** ADR-001 (Command-Centric Architecture)

## Context

Currently, the workon CLI operates with a "all-or-nothing" approach where running `workon my-project` executes all configured events for that project. However, there are scenarios where users want to execute only specific commands for a project.

### Current Behavior
```bash
workon my-project    # Executes ALL configured events (cwd, ide, claude, npm, etc.)
```

### Desired Behavior
```bash
workon my-project           # Executes all configured events (current behavior)
workon my-project cwd       # Only changes to project directory
workon my-project claude    # Only opens Claude in project directory
workon my-project npm       # Only runs npm command
workon my-project cwd claude # Runs cwd + claude (split terminal)
```

## Problems with Current Approach

1. **Inflexibility**: Can't run individual commands without modifying project configuration
2. **Performance**: Sometimes you don't want to start dev server, just open Claude
3. **Workflow Mismatch**: Different workflows need different command combinations
4. **Resource Usage**: Starting all services when you only need one is wasteful

### Common Use Cases

- **Quick directory change**: `workon my-project cwd`
- **AI assistance only**: `workon my-project claude` 
- **Development startup**: `workon my-project cwd claude npm`
- **IDE-only launch**: `workon my-project ide`
- **Terminal + build**: `workon my-project cwd npm`

## Decision

Implement **positional command arguments** that allow users to specify which commands to execute for a project, while maintaining backward compatibility with the current "execute all" behavior.

## Proposed Implementation

### 1. CLI Argument Structure

```bash
workon <project> [command1] [command2] [...commandN] [options]
```

**Examples:**
```bash
workon my-project                    # All configured events
workon my-project cwd                # Just directory change
workon my-project claude             # Just Claude
workon my-project cwd claude         # Directory + Claude
workon my-project cwd claude npm     # Full development setup
workon my-project ide --shell        # IDE with shell output
```

### 2. Argument Parsing Logic

```javascript
// Enhanced argument parsing
class ProjectArgumentParser {
    static parse(args) {
        const projectName = args[0];
        const commands = args.slice(1).filter(arg => !arg.startsWith('--'));
        const flags = args.slice(1).filter(arg => arg.startsWith('--'));
        
        return {
            projectName,
            commands: commands.length > 0 ? commands : null, // null means "all configured"
            flags
        };
    }
    
    static validate(projectName, commands, projectConfig) {
        // Validate that requested commands are configured for the project
        const configuredEvents = Object.keys(projectConfig.events || {});
        const invalidCommands = commands.filter(cmd => !configuredEvents.includes(cmd));
        
        if (invalidCommands.length > 0) {
            throw new Error(`Commands not configured for project '${projectName}': ${invalidCommands.join(', ')}`);
        }
    }
}
```

### 3. Execution Logic

```javascript
// cli/open.js - Enhanced execution
class open extends command {
    async processProject(project, requestedCommands = null) {
        const projectConfig = this.getProjectConfig(project);
        const configuredEvents = Object.keys(projectConfig.events || {});
        
        // Determine which events to execute
        let eventsToExecute;
        if (requestedCommands) {
            // Validate requested commands are configured
            this.validateRequestedCommands(requestedCommands, configuredEvents, project);
            eventsToExecute = requestedCommands;
        } else {
            // Execute all configured events (current behavior)
            eventsToExecute = configuredEvents.filter(e => projectConfig.events[e]);
        }
        
        await this.executeEvents(projectConfig, eventsToExecute);
    }
    
    validateRequestedCommands(requested, configured, projectName) {
        const invalid = requested.filter(cmd => !configured.includes(cmd));
        if (invalid.length > 0) {
            throw new Error(
                `Commands not configured for project '${projectName}': ${invalid.join(', ')}\n` +
                `Available commands: ${configured.join(', ')}`
            );
        }
    }
}
```

### 4. Smart Layout Detection

The intelligent layout detection from ADR-001 would work with positional arguments:

```javascript
// Layout detection based on actual commands being executed
const layoutDetection = {
    determineLayout(executedCommands, projectConfig) {
        const hasCwd = executedCommands.includes('cwd');
        const hasClaude = executedCommands.includes('claude');
        const hasNpm = executedCommands.includes('npm');
        
        if (hasCwd && hasClaude && hasNpm) {
            return 'three-pane'; // Claude + Terminal + NPM
        } else if (hasCwd && hasNpm) {
            return 'two-pane-npm'; // Terminal + NPM
        } else if (hasCwd && hasClaude) {
            return 'two-pane-claude'; // Claude + Terminal
        } else {
            return 'individual'; // Execute commands individually
        }
    }
};
```

### 5. Help and Discovery

Enhanced help system that shows available commands per project:

```bash
workon my-project --help
# Output:
# Available commands for 'my-project':
#   cwd     - Change to project directory
#   claude  - Open Claude Code with --resume flag
#   npm     - Run 'npm run dev'
#   ide     - Open in VS Code
#
# Usage:
#   workon my-project [command1] [command2] ...
#
# Examples:
#   workon my-project cwd claude    # Split terminal with Claude
#   workon my-project npm           # Just start dev server
```

## Integration with ADR-001

This feature complements the Command-Centric Architecture:

### Command Interface Extension
```javascript
class NPMCommand {
    static metadata = {
        name: 'npm',
        displayName: 'Run NPM command',
        canRunIndividually: true,    // Can be executed alone
        requiresProject: true,       // Needs project context
        dependencies: ['npm']
    }
    
    static help = {
        shortDescription: 'Run npm scripts',
        individualUsage: 'workon <project> npm',
        examples: [
            'workon my-app npm              # Run configured npm script',
            'workon my-app cwd npm          # Terminal + npm in split'
        ]
    }
}
```

### Enhanced Command Registry
```javascript
class CommandRegistry {
    static getAvailableCommandsForProject(projectConfig) {
        const configuredEvents = Object.keys(projectConfig.events || {});
        return configuredEvents.map(eventName => {
            const command = this.getCommandByName(eventName);
            return {
                name: eventName,
                description: command.metadata.displayName,
                canRunIndividually: command.metadata.canRunIndividually
            };
        });
    }
}
```

## Implementation Challenges

### 1. Argument Parsing Complexity
**Challenge**: Distinguishing between project names and commands
```bash
workon claude my-project    # Project named 'claude' or command 'claude' on 'my-project'?
```

**Solution**: Commands are always positional after project name:
```bash
workon my-project claude    # ✅ Clear: project 'my-project', command 'claude'
workon claude               # ✅ Clear: project 'claude', no specific commands
```

### 2. Command Validation
**Challenge**: What if user requests a command that's not configured?

**Options:**
- **Strict**: Error if command not configured
- **Permissive**: Execute if command exists, ignore configuration
- **Hybrid**: Warn but execute if possible

**Recommendation**: Start strict, add permissive mode with flag later.

### 3. Backward Compatibility
**Challenge**: Ensure existing usage patterns continue to work

**Solution**: No commands specified = execute all (current behavior)
```bash
workon my-project           # Still works as before
workon my-project --shell   # Still works as before
```

### 4. Complex Command Interactions
**Challenge**: Some commands have dependencies or conflicts

**Examples:**
- `claude` without `cwd` - should we auto-add `cwd`?
- `npm` without `cwd` - doesn't make sense

**Solution**: Command dependency resolution:
```javascript
class CommandDependencyResolver {
    static resolve(requestedCommands, projectConfig) {
        const resolved = [...requestedCommands];
        
        // Auto-add dependencies
        if (requestedCommands.includes('npm') && !requestedCommands.includes('cwd')) {
            resolved.unshift('cwd'); // npm needs cwd
        }
        
        if (requestedCommands.includes('claude') && !requestedCommands.includes('cwd')) {
            resolved.unshift('cwd'); // claude needs cwd
        }
        
        return resolved;
    }
}
```

## User Experience Design

### 1. Intuitive Command Discovery
```bash
workon my-project help      # Show available commands for this project
workon help commands        # Show all available command types
workon --list-projects      # Show all projects with their commands
```

### 2. Smart Defaults
```bash
workon my-project claude    # Automatically includes 'cwd' dependency
workon my-project npm       # Automatically includes 'cwd' dependency
```

### 3. Error Messages
```bash
workon my-project invalid-cmd
# Error: Command 'invalid-cmd' not configured for project 'my-project'
# Available commands: cwd, claude, npm, ide
# 
# Tip: Run 'workon my-project help' for more details
```

## Implementation Plan

### Phase 1: Argument Parsing Foundation
1. Implement `ProjectArgumentParser` class
2. Update CLI entry point to handle positional arguments
3. Add backward compatibility tests
4. Basic command validation

### Phase 2: Command Execution Logic
1. Update `open.js` to handle selective command execution
2. Implement dependency resolution system
3. Add error handling and user-friendly messages
4. Update help system

### Phase 3: Layout Integration
1. Update smart layout detection for positional commands
2. Ensure tmux layouts work with partial command sets
3. Add fallback behavior for unsupported combinations

### Phase 4: Enhanced UX
1. Add command discovery helpers
2. Implement auto-completion support
3. Add command validation with helpful suggestions
4. Enhanced help and documentation

## Success Criteria

1. **Backward Compatibility**: `workon my-project` works exactly as before
2. **Individual Commands**: `workon my-project cwd` only changes directory
3. **Command Combinations**: `workon my-project cwd claude` creates split terminal
4. **Error Handling**: Clear messages for invalid command combinations
5. **Help System**: Users can discover available commands per project
6. **Performance**: Single commands execute faster than full project setup

## Examples

### Basic Usage
```bash
# Current behavior preserved
workon my-app                    # All configured events

# New individual command usage
workon my-app cwd                # Just cd to directory
workon my-app claude             # Just open Claude (with auto cwd)
workon my-app ide                # Just open IDE
workon my-app npm                # Just run npm script (with auto cwd)
```

### Advanced Combinations
```bash
# Custom combinations
workon my-app cwd claude         # Split terminal: Claude + shell
workon my-app cwd npm            # Split terminal: shell + npm
workon my-app cwd claude npm     # Three-pane: Claude + shell + npm
workon my-app ide claude         # IDE + Claude (no terminal)
```

### Shell Mode
```bash
# Shell mode with positional args
workon my-app cwd --shell        # Just outputs: cd "/path/to/project"
workon my-app cwd claude --shell # Outputs tmux split commands
```

## Benefits

### For Users
- **Flexibility**: Run only what you need
- **Performance**: Faster startup for individual commands
- **Workflow Optimization**: Match commands to specific use cases
- **Resource Efficiency**: Don't start unnecessary services

### For Development
- **Testing**: Easier to test individual commands
- **Debugging**: Isolate issues to specific commands
- **Modularity**: Commands become more independent

### For Future Features
- **Command Aliases**: `workon my-app dev` → `workon my-app cwd claude npm`
- **Profiles**: Save common command combinations
- **Conditional Logic**: Run commands based on project state

## Risks and Mitigations

### Risk: User Confusion
**Mitigation**: Clear documentation, intuitive defaults, helpful error messages

### Risk: Complex Dependency Resolution
**Mitigation**: Start simple, add complexity incrementally, clear logging

### Risk: Breaking Changes
**Mitigation**: Maintain backward compatibility, opt-in behavior

### Risk: Command Conflicts
**Mitigation**: Define clear command interaction rules, validation system

This ADR provides a comprehensive plan for adding positional command arguments while maintaining the project's usability and setting the foundation for even more flexible workflow management.