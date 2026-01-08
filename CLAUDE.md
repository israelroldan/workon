# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`workon` is a TypeScript CLI tool for managing development projects and environments. It helps developers quickly switch between projects, configure IDEs, manage git branches, and optionally create tmux sessions with Claude Code integration.

## Development Commands

```bash
pnpm install                # Install dependencies
pnpm run dev                # Run CLI directly with tsx (development)
pnpm run build              # Build with tsup
pnpm run type-check         # TypeScript type checking
pnpm run lint               # ESLint
pnpm run lint:fix           # ESLint with auto-fix
pnpm run format             # Prettier format
pnpm run test               # Run tests with Vitest
pnpm run test:coverage      # Run tests with coverage
node bin/workon --debug     # Run built CLI with debug output
```

## Architecture

### Directory Structure

```
src/
├── cli.ts                  # CLI entry point
├── index.ts                # Library exports
├── types/
│   ├── index.ts            # Type definitions
│   └── declarations.d.ts   # Declarations for untyped deps
├── commands/               # Commander.js CLI commands
│   ├── index.ts            # createCli() factory
│   ├── open.ts             # Project opening, tmux layout orchestration
│   ├── interactive.ts      # Interactive prompts for project setup
│   ├── manage.ts           # Project management
│   └── config/
│       ├── index.ts        # Config subcommand container
│       ├── list.ts
│       ├── set.ts
│       └── unset.ts
├── events/                 # Event system (auto-discovered)
│   ├── base.ts             # BaseEvent interface
│   ├── registry.ts         # EventRegistry singleton
│   ├── core/
│   │   ├── cwd.ts          # Change directory
│   │   ├── ide.ts          # Open IDE
│   │   └── web.ts          # Open browser
│   └── extensions/
│       ├── claude.ts       # Claude Code integration
│       ├── npm.ts          # NPM scripts
│       └── docker.ts       # Docker compose
└── lib/
    ├── config.ts           # Conf wrapper with transient/persistent separation
    ├── project.ts          # Project model class
    ├── environment.ts      # Environment recognition system
    └── tmux.ts             # Tmux session management
tests/
dist/                       # Built output (ESM + CJS)
```

### Key Patterns

**Commander.js CLI**: Commands are factory functions that return `Command` instances. Subcommands use `.addCommand()`.

**Event Registry**: Events in `src/events/core/` and `src/events/extensions/` are auto-discovered. Each must export a class with static `metadata`, `validation`, `configuration`, and `processing` properties.

**Shell Integration**: `workon --init` generates a shell function. When users run `workon projectName`, it calls `workon --shell projectName` and evals the output to execute in the current shell.

**Tmux Layouts**: `src/commands/open.ts` detects enabled events and creates appropriate tmux layouts:
- `cwd + claude`: Two-pane (Claude left, terminal right)
- `cwd + npm`: Two-pane (terminal left, npm right)
- `cwd + claude + npm`: Three-pane layout

**Environment Recognition**: `src/lib/environment.ts` matches the current directory against configured projects and detects git branches. Branch-specific configs use `project#branch` naming.

**Configuration**: Uses `conf` package. Transient keys (`pkg`, `work`) stay in memory; all others persist to disk.

### Adding a New Event

1. Create `src/events/extensions/yourevent.ts`
2. Export a class with required static properties:
   - `metadata`: `{ name, displayName, description, category, requiresTmux, dependencies }`
   - `validation`: `{ validateConfig(config) }`
   - `configuration`: `{ configureInteractive(), getDefaultConfig() }`
   - `processing`: `{ processEvent(context), generateShellCommand(context) }`
3. Optionally add `tmux` property for layout integration

### Project Configuration Structure

```typescript
{
  project_defaults: { base: "~/code" },
  projects: {
    myproject: {
      path: "myproject",      // Relative to base
      ide: "vscode",          // vscode | idea | atom | code | subl | vim | emacs
      events: {
        cwd: true,
        ide: true,
        claude: { flags: ["--model", "opus"] },
        npm: "dev"
      }
    }
  }
}
```

### Colon Syntax

Users can run specific commands: `workon myproject:cwd,ide` or get help with `workon myproject:help`

## Technology Stack

- TypeScript 5.x with strict mode
- Commander.js for CLI
- @inquirer/prompts for interactive prompts
- tsup for building (ESM + CJS)
- Vitest for testing
- ESLint 9 flat config + Prettier
- Husky + lint-staged for git hooks
- GitHub Actions for CI/CD
- release-please for automated releases
