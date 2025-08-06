# Ideas for workon

This document contains ideas for future enhancements to the workon project.

## Interactive Project Management

### Project Configuration Editor
Create an interactive mode for editing project configurations through guided prompts instead of manual file editing.

**Features:**
- Interactive project creation wizard with step-by-step guidance
- Edit existing project properties (name, path, IDE, events) through prompts
- Validate project paths and IDE commands during configuration
- Preview configuration changes before saving
- Bulk operations for managing multiple projects

**Implementation considerations:**
- Extend existing inquirer-based interactive system
- Add new command like `workon config` or `workon manage --interactive`
- Provide different flows for:
  - Creating new projects
  - Editing existing projects
  - Bulk project management
- Include validation for:
  - Directory paths existence
  - IDE command availability
  - Event configuration correctness

**Benefits:**
- Lower barrier to entry for new users
- Reduced configuration errors through validation
- More discoverable project management features
- Better UX compared to manual JSON editing

## Enhanced Events

### Advanced claude Event Options ✅ IMPLEMENTED
The claude event now supports advanced configuration options:
```json
"claude": {
  "flags": ["--resume", "--debug"]
}
```

**Available through:** `workon manage` → Configure advanced Claude options

### Split Terminal with Claude + CWD
When both `claude` and `cwd` events are enabled, automatically create a split terminal layout:
- **Left pane**: Claude Code running in project directory
- **Right pane**: Shell terminal in project directory  

**Implementation approach:**
- Use tmux to create split session
- Detect when both events are present
- Create session: `tmux new-session -d -s "workon-{project}"`
- Split horizontally: `tmux split-window -h`
- Run claude in left pane, shell in right pane
- Attach to session

**Configuration:**
```json
"claude": {
  "flags": ["--resume"],
  "split_terminal": true
}
```

**Benefits:**
- Claude and terminal side-by-side for optimal workflow
- Easy switching between AI assistance and command execution
- Persistent session that can be reattached

### Future claude Event Enhancements
Additional options that could be implemented:
```json
"claude": {
  "flags": ["--resume"],
  "mode": "interactive", 
  "project_context": true,
  "working_directory": "src/",
  "tmux_layout": "even-horizontal"
}
```

## Future Ideas

*Add more ideas here as they come up...*