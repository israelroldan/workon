# Ideas for workon

This document contains ideas for future enhancements to the workon project.

## New Events

### claude Event
Launch Claude Code in the project directory after setting the working directory.

**Usage:**
```json
{
  "name": "myproject",
  "path": "projects/myproject",
  "events": {
    "cwd": true,
    "claude": true
  }
}
```

**Implementation considerations:**
- Should run after `cwd` event to ensure proper directory context
- Need to detect if Claude Code CLI is available (`claude` command)
- Could support different Claude modes/flags as event options:
  ```json
  "claude": {
    "mode": "interactive",
    "flags": ["--resume"]
  }
  ```

**Benefits:**
- Seamless integration with modern AI-assisted development workflow
- Automatic context switching to project directory in Claude
- Consistent development environment setup

## Future Ideas

*Add more ideas here as they come up...*