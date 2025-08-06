# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`workon` is a Node.js CLI tool for managing development projects and environments. It helps developers quickly switch between projects, configure IDEs, and manage git branches through an interactive interface.

## Development Commands

### Release Management
```bash
npm run release              # Create a new release using standard-version
```

### Installation and Usage
```bash
npm install                  # Install dependencies
node bin/workon             # Run the CLI tool directly
npm link                    # Install globally for development
```

## Architecture

### Core Components

**CLI Entry Point (`bin/workon`)**
- Main executable that initializes logging and runs the CLI
- Supports `--debug` flag for detailed logging

**Command System (`cli/`)**
- `cli/index.js`: Main CLI class extending switchit's container pattern
- `cli/interactive.js`: Interactive mode for project setup and management
- `cli/open.js`: Project opening and environment switching
- `cli/config/`: Configuration management commands

**Project Management (`lib/`)**
- `lib/project.js`: Project class with path, IDE, events, and branch properties
- `lib/environment/`: Environment recognition and project detection
- `lib/config.js`: Configuration storage using the `conf` package

### Key Architectural Patterns

**Environment Recognition**
- Automatically detects if current directory is a configured project
- Matches project paths against configuration
- Integrates with git to detect current branch
- Supports branch-specific project configurations (e.g., `project#branch`)

**Configuration System**
- Uses `conf` package for persistent storage
- Separates transient properties (`pkg`, `work`) from persistent config
- Stores project definitions and defaults
- Configuration lives in user's config directory

**Interactive Flow**
- Context-aware prompts based on current environment
- Different options when inside vs outside project directories
- Supports creating new projects, branches, and managing existing ones

**Event System**
- Projects can define events that trigger when opening:
  - `cwd`: Change terminal directory to project path
  - `ide`: Open project in configured IDE (VS Code, IntelliJ, Atom)
  - `web`: Open project homepage in browser
- Events are processed when switching to a project

### Project Configuration Structure

Projects are stored with these properties:
- `name`: Project identifier
- `path`: Relative path from base directory
- `ide`: IDE command (`vscode`, `idea`, `atom`)
- `events`: Object defining which events to trigger
- `branch`: Git branch (for branch-specific configs)

### Dependencies

**Core Dependencies**
- `switchit`: CLI framework for commands and arguments
- `inquirer`: Interactive command-line prompts
- `conf`: Configuration storage
- `phylo`: File system utilities
- `simple-git`: Git integration
- `loog`: Logging system

**Utility Dependencies**
- `deep-assign`: Object merging
- `flat`: Object flattening
- `omelette`: Shell completion
- `openurl2`: Browser opening

## Development Notes

- The tool uses a class-based architecture with command inheritance
- Configuration is automatically managed and persisted
- Environment detection works by matching canonical paths
- Interactive mode provides different UX based on context
- Shell completion is supported via omelette
- Git integration detects current branch for branch-specific configs