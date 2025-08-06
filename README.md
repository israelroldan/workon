# workon

> Work on something great! 🚀

A productivity CLI tool that helps developers quickly switch between projects with automatic environment setup. No more manually navigating to project directories, opening IDEs, or remembering project-specific commands.

## Features

✨ **Smart Project Switching** - Switch between projects in your current shell (no nested processes!)  
🔧 **IDE Integration** - Automatically open projects in VS Code, IntelliJ IDEA, or Atom  
🌐 **Web Integration** - Launch project websites and documentation  
🌳 **Git Branch Support** - Different configurations for different branches  
📁 **Auto Directory Change** - Seamlessly `cd` into project directories  
⚡ **Interactive Setup** - Guided project configuration  
🔄 **Backward Compatible** - Legacy nested shell mode still available

## Installation

### Option 1: Global Installation (Recommended)

```bash
# Install globally
npm install -g workon

# Set up shell integration (one time setup)
echo 'eval "$(workon --init)"' >> ~/.zshrc    # for zsh
echo 'eval "$(workon --init)"' >> ~/.bashrc   # for bash

# Reload your shell
source ~/.zshrc  # or ~/.bashrc
```

### Option 2: Using npx (No Global Install)

```bash
# Set up shell integration
echo 'eval "$(npx workon --init)"' >> ~/.zshrc    # for zsh  
echo 'eval "$(npx workon --init)"' >> ~/.bashrc   # for bash

# Reload your shell
source ~/.zshrc  # or ~/.bashrc
```

### Verify Installation

```bash
workon --help
```

## Quick Start

1. **Create your first project:**
   ```bash
   workon  # Start interactive mode
   ```

2. **Switch to a project:**
   ```bash
   workon myproject  # Automatically cd + open IDE
   ```

3. **List available projects:**
   ```bash
   workon config list
   ```

## Project Configuration

Projects are configured with:

- **Path**: Where your project lives
- **IDE**: Which editor to open (`code`, `idea`, `atom`)  
- **Events**: What happens when switching to the project
  - `cwd`: Change directory to project path
  - `ide`: Open project in configured IDE
  - `web`: Open project homepage/docs

### Interactive Project Setup

Run `workon` to start the interactive setup wizard:

```bash
$ workon
                      8                v1.0.0-alpha.1
Yb  db  dP .d8b. 8d8b 8.dP .d8b. 8d8b.
 YbdPYbdP  8' .8 8P   88b  8' .8 8P Y8
  YP  YP   `Y8P' 8    8 Yb `Y8P' 8   8

? What do you want to do?
❯ Start a new project
  Open an existing project  
  Manage projects
  Exit
```

### Manual Configuration

```bash
# Set base directory for all projects
workon config set project_defaults.base ~/code

# Add a project
workon config set projects.myapp.path myapp
workon config set projects.myapp.ide code
workon config set projects.myapp.events.cwd true
workon config set projects.myapp.events.ide true
```

## Usage Examples

### Basic Project Switching
```bash
# Switch to project (changes directory + opens IDE)
workon myproject

# Shell mode - outputs commands instead of executing
workon myproject --shell
# Output: cd "/path/to/myproject"
#         code "/path/to/myproject" &
```

### Branch-Specific Configuration
```bash
# Configure different settings for a git branch
workon myproject#feature-branch
```

### Legacy Mode (Nested Shells)
```bash
# Use the old behavior if needed (spawns new shell)
workon myproject --no-shell  # (this is the default)
```

### Configuration Management
```bash
# List all configuration
workon config list

# Set a value
workon config set key value

# Remove a value  
workon config unset key
```

## Shell Integration Details

The modern shell integration works by:

1. **Setup**: `workon --init` outputs a shell function
2. **Usage**: When you run `workon myproject`, the function:
   - Calls `workon myproject --shell` to get commands
   - Uses `eval` to execute them in your current shell
3. **Result**: No nested shells, seamless directory changes

### Manual Shell Integration

If you prefer not to modify your shell config:

```bash
# Get commands and execute manually
eval "$(workon myproject --shell)"

# Or see what commands would run
workon myproject --shell
```

## Advanced Usage

### Environment Detection

`workon` automatically detects when you're in a configured project directory and shows relevant options.

### Shell Completion

Set up tab completion:

```bash
workon --setup-completion
```

### Debug Mode

Troubleshoot with debug output:

```bash
workon myproject --debug
```

## Configuration Storage

Configuration is stored using the [`conf`](https://github.com/sindresorhus/conf) package in your system's config directory:

- **macOS**: `~/Library/Preferences/workon/`
- **Linux**: `~/.config/workon/`  
- **Windows**: `%APPDATA%/workon/`

## Migration from Legacy Mode

If you've been using the nested shell mode, the new shell integration provides the same functionality without the shell nesting issues. Both modes continue to work:

- **Legacy**: `workon myproject` (spawns new shell)
- **Modern**: `workon myproject` (with shell integration setup)

## Contributing

This project uses [standard-version](https://github.com/conventional-changelog/standard-version) for releases.

```bash
npm run release
```

## License

MIT © [Israel Roldan](https://github.com/israelroldan)