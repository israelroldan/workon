# cmux Integration Design

## Overview

Add cmux (a native macOS terminal for AI coding agents) as an alternative terminal multiplexer alongside tmux in workon. The integration uses a strategy pattern with runtime auto-detection, requiring no user configuration.

## Decisions

- **cmux as an option alongside tmux**, not a replacement
- **Pane management only** for the initial implementation — no cmux-specific features (notifications, sidebar metadata, browser) yet
- **Auto-detect at runtime** — no config setting needed
- **Context-aware priority** — if running inside cmux, use cmux; otherwise default to tmux
- **Multiplexer interface + strategy pattern** — clean abstraction for both implementations

## Architecture

### TerminalMultiplexer Interface

A shared interface extracted from `TmuxManager`'s existing API surface. Both `TmuxManager` and `CmuxManager` implement it.

```typescript
interface TerminalMultiplexer {
  readonly name: string // 'tmux' | 'cmux'

  // Availability
  isAvailable(): Promise<boolean>

  // Session/Workspace management
  sessionExists(name: string): Promise<boolean>
  getSessionName(projectName: string): string
  getWorktreeSessionName(projectName: string, worktreeName: string): string
  killSession(name: string): Promise<void>
  listWorkonSessions(): Promise<string[]>

  // Layout creation
  createSplitSession(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[]
  ): Promise<string>
  createThreePaneSession(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[],
    npmCommand?: string
  ): Promise<string>
  createTwoPaneNpmSession(
    projectName: string,
    projectPath: string,
    npmCommand?: string
  ): Promise<string>

  // Attachment
  attachToSession(name: string): Promise<void>
  getAttachCommand(name: string): string

  // Shell command generation (for --shell mode)
  buildShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[]
  ): string[]
  buildThreePaneShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[],
    npmCommand?: string
  ): string[]
  buildTwoPaneNpmShellCommands(
    projectName: string,
    projectPath: string,
    npmCommand?: string
  ): string[]
}
```

### Environment Detection & Factory

Located in `src/lib/multiplexer.ts`:

```typescript
function detectMultiplexer(): Promise<TerminalMultiplexer | null>
```

Detection logic:

1. Check if running inside cmux — `CMUX_WORKSPACE_ID` or `CMUX_SURFACE_ID` env vars are set (cmux auto-sets these for child processes)
2. If yes, return `CmuxManager`
3. If no, check if tmux is available (`tmux -V`)
4. If yes, return `TmuxManager`
5. If neither, return `null` (workon already handles this with fallback behavior)

### CmuxManager Implementation

Located in `src/lib/cmux.ts`. Conceptual mapping from tmux to cmux:

| tmux concept | cmux equivalent |
|---|---|
| session | workspace |
| split-window | new-split |
| attach-session / switch-client | select-workspace |
| send-keys | send / send-surface |
| kill-session | close-workspace |
| list-sessions | list-workspaces |

**Availability:** Check for `cmux` binary + `cmux ping` to confirm the app is running and socket is reachable.

**Session/Workspace management:**

- `sessionExists()` — `cmux list-workspaces --json`, check for workon-prefixed name
- `getSessionName()` / `getWorktreeSessionName()` — same naming scheme (`workon-{project}`)
- `killSession()` — `cmux close-workspace --workspace {id}`
- `listWorkonSessions()` — `cmux list-workspaces --json`, filter by `workon-` prefix

**Layout creation:**

- `createSplitSession()` — `cmux new-workspace` then `cmux new-split right` then `cmux send-surface {left} "claude ..."` + `cmux send-key-surface {left} enter`
- `createThreePaneSession()` — `cmux new-workspace` then `cmux new-split right` then `cmux new-split down` (on right pane) then send claude to left, npm to bottom-right
- `createTwoPaneNpmSession()` — `cmux new-workspace` then `cmux new-split right` then send npm to right pane

**Attachment:**

- `attachToSession()` — `cmux select-workspace --workspace {id}` (already inside cmux, just focus)
- `getAttachCommand()` — returns `cmux select-workspace` command string

**Shell mode:** cmux commands are regular CLI calls via the socket — sequential `cmux` invocations. No `exec $SHELL` wrappers or iTerm2 `-CC` detection needed.

### Changes to open.ts

- Replace `new TmuxManager()` with `await detectMultiplexer()`
- Replace all `tmux.xxx()` calls with `mux.xxx()` — mechanical rename
- `isTmuxAvailable()` checks become `mux !== null`
- Handler function parameter types change from `TmuxManager` to `TerminalMultiplexer`

What stays the same:

- Layout detection logic (`cwd + claude + npm` → three-pane, etc.)
- Event processing order and dependency resolution
- `LayoutConfig` type and handler functions
- Dry-run mode
- Colon syntax parsing

iTerm2 detection (`tmux -CC` mode) stays inside `TmuxManager.attachToSession()` — `CmuxManager` doesn't need it.

### Event System Renames

Minimal renames for accuracy:

- `EventTmux` → `EventMultiplexer`
- `requiresTmux` → `requiresMultiplexer`
- `getTmuxEnabledEvents()` → `getMultiplexerEnabledEvents()`

No changes to event behavior. Layout hints (`'split'`, `'three-pane'`) are already multiplexer-agnostic.

## File Changes

### New files

- `src/lib/multiplexer.ts` — `TerminalMultiplexer` interface + `detectMultiplexer()` factory
- `src/lib/cmux.ts` — `CmuxManager implements TerminalMultiplexer`
- `tests/cmux.test.ts` — unit tests for `CmuxManager`
- `tests/multiplexer.test.ts` — tests for detection logic

### Modified files

- `src/lib/tmux.ts` — add `implements TerminalMultiplexer`, add `readonly name = 'tmux'`
- `src/commands/open.ts` — swap `new TmuxManager()` for `detectMultiplexer()`, type params as `TerminalMultiplexer`
- `src/types/index.ts` — rename `EventTmux` → `EventMultiplexer`, `requiresTmux` → `requiresMultiplexer`
- `src/events/registry.ts` — update method name and references
- `src/events/extensions/claude.ts` — update property names
- `src/events/extensions/npm.ts` — update property names
- `src/events/core/cwd.ts` — update property name (`requiresMultiplexer: false`)
- `src/events/core/ide.ts` — update property name (`requiresMultiplexer: false`)

### Untouched

- `src/cli.ts`, `src/index.ts`
- `src/lib/config.ts`, `src/lib/project.ts`, `src/lib/environment.ts`
- `src/commands/interactive.ts`, `src/commands/manage.ts`, `src/commands/config/*`
- `src/events/extensions/docker.ts`, `src/events/core/web.ts`
- Existing tests (tmux behavior unchanged)

## Future Work (out of scope)

These cmux-specific features can be added incrementally once pane management is solid:

- **Notifications** — `cmux notify` when events complete or agents need attention
- **Sidebar metadata** — git branch, project name, status pills via `cmux set-status`
- **Progress tracking** — `cmux set-progress` / `cmux log` for builds
- **In-app browser** — auto-open `homepage` URLs in cmux's browser pane
- **User configuration** — explicit `multiplexer` setting in project config for overriding auto-detection
