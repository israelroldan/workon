# Ideas for workon

This document contains ideas for future enhancements to the workon project.

## NPM Command Integration

### Three-Pane Development Layout
When `cwd`, `claude`, and `npm` events are enabled, create a three-pane tmux layout:
- **Left pane**: Claude Code running in project directory (full height)
- **Top-right pane**: Shell terminal in project directory  
- **Bottom-right pane**: NPM command running (e.g., `npm run dev`, `npm test`)

**Implementation approach:**
- Extend current split terminal to support three panes
- Create initial vertical split (Claude | Terminal)
- Split the right terminal pane horizontally (Terminal | npm)
- Use tmux: `split-window -v` on the right pane
- Auto-run specified npm command in bottom-right pane

**Configuration:**
```json
{
  "events": {
    "cwd": "true",
    "claude": {
      "flags": ["--resume"],
      "split_terminal": true
    },
    "npm": "dev"
  }
}
```

**Alternative configuration:**
```json
{
  "events": {
    "cwd": "true", 
    "claude": "true",
    "npm": {
      "command": "dev",
      "watch": true,
      "auto_restart": false
    }
  }
}
```

**Benefits:**
- Complete development environment in one tmux session
- Claude AI + Terminal + Development server all visible
- Perfect for web development workflows
- Automatic npm script execution

**Tmux Layout:**
```
┌──────────────┬──────────────┐
│              │   Terminal   │
│    Claude    ├──────────────┤
│   (full      │ npm run dev  │
│   height)    │              │
└──────────────┴──────────────┘
```

### Two-Pane Terminal + NPM Layout
When `cwd` and `npm` events are enabled (without Claude), create a two-pane tmux layout:
- **Left pane**: Shell terminal in project directory
- **Right pane**: NPM command running (e.g., `npm run dev`, `npm test`)

**Tmux Layout:**
```
┌──────────────┬──────────────┐
│              │              │
│   Terminal   │ npm run dev  │
│              │              │
│              │              │
└──────────────┴──────────────┘
```

**Use cases:**
- Traditional development workflow without AI assistance
- Monitoring build output while running commands
- Side-by-side terminal and dev server

## Future Ideas

### Auto-enable Split Terminal
When both `cwd` and `claude` events are enabled, automatically enable split terminal mode without requiring explicit configuration.

### Project Templates
Pre-configured project templates for common development stacks (React, Node.js, Python, etc.) with appropriate events and npm commands.

*Add more ideas here as they come up...*