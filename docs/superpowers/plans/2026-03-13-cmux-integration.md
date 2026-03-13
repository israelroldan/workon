# cmux Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cmux as an alternative terminal multiplexer alongside tmux, with runtime auto-detection and a shared interface.

**Architecture:** Extract a `TerminalMultiplexer` interface from `TmuxManager`, implement `CmuxManager` as a second strategy, and use a factory function (`detectMultiplexer()`) that picks the right implementation based on environment. All consumers switch from `new TmuxManager()` to `detectMultiplexer()`.

**Tech Stack:** TypeScript, Commander.js, Vitest, child_process (exec/spawn)

**Spec:** `docs/superpowers/specs/2026-03-13-cmux-integration-design.md`

---

## Chunk 1: Interface & Factory (foundation)

### Task 1: Create TerminalMultiplexer interface and detectMultiplexer factory

**Files:**
- Create: `src/lib/multiplexer.ts`
- Create: `tests/multiplexer.test.ts`

- [ ] **Step 1: Write the failing test for detectMultiplexer**

```typescript
// tests/multiplexer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock TmuxManager before importing
vi.mock('../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => ({
    name: 'tmux',
    isTmuxAvailable: vi.fn().mockResolvedValue(true),
    isAvailable: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock CmuxManager before importing
vi.mock('../src/lib/cmux.js', () => ({
  CmuxManager: vi.fn().mockImplementation(() => ({
    name: 'cmux',
    isAvailable: vi.fn().mockResolvedValue(true),
  })),
}));

import { detectMultiplexer } from '../src/lib/multiplexer.js';
import type { TerminalMultiplexer } from '../src/lib/multiplexer.js';

describe('detectMultiplexer', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return CmuxManager when CMUX_WORKSPACE_ID is set', async () => {
    process.env.CMUX_WORKSPACE_ID = 'test-workspace';
    const mux = await detectMultiplexer();
    expect(mux).not.toBeNull();
    expect(mux!.name).toBe('cmux');
  });

  it('should return CmuxManager when CMUX_SURFACE_ID is set', async () => {
    process.env.CMUX_SURFACE_ID = 'test-surface';
    const mux = await detectMultiplexer();
    expect(mux).not.toBeNull();
    expect(mux!.name).toBe('cmux');
  });

  it('should return TmuxManager when not in cmux and tmux is available', async () => {
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    const mux = await detectMultiplexer();
    expect(mux).not.toBeNull();
    expect(mux!.name).toBe('tmux');
  });

  it('should return null when neither is available', async () => {
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;

    // Override the TmuxManager mock to report unavailable
    const { TmuxManager } = await import('../src/lib/tmux.js');
    vi.mocked(TmuxManager).mockImplementation(
      () =>
        ({
          name: 'tmux',
          isAvailable: vi.fn().mockResolvedValue(false),
        }) as any
    );

    // Also override CmuxManager to be unavailable (it won't be checked since
    // no CMUX_ env vars are set, but be explicit)
    const { CmuxManager } = await import('../src/lib/cmux.js');
    vi.mocked(CmuxManager).mockImplementation(
      () =>
        ({
          name: 'cmux',
          isAvailable: vi.fn().mockResolvedValue(false),
        }) as any
    );

    // Re-import detectMultiplexer to pick up the new mocks.
    // Use vi.resetModules() + dynamic import to get a fresh module instance.
    vi.resetModules();
    const { detectMultiplexer: freshDetect } = await import('../src/lib/multiplexer.js');
    const mux = await freshDetect();
    expect(mux).toBeNull();
  });
});

describe('TerminalMultiplexer interface', () => {
  it('should export the TerminalMultiplexer type', async () => {
    // This test verifies the interface is exported and usable as a type
    const mux: TerminalMultiplexer | null = null;
    expect(mux).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/multiplexer.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the TerminalMultiplexer interface and detectMultiplexer factory**

```typescript
// src/lib/multiplexer.ts
import { TmuxManager } from './tmux.js';
import { CmuxManager } from './cmux.js';

export interface TerminalMultiplexer {
  readonly name: string;

  // Availability
  isAvailable(): Promise<boolean>;

  // Session/Workspace management
  sessionExists(name: string): Promise<boolean>;
  getSessionName(projectName: string): string;
  getWorktreeSessionName(projectName: string, worktreeName: string): string;
  killSession(name: string): Promise<boolean>;
  listWorkonSessions(): Promise<string[]>;

  // Layout creation
  createSplitSession(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[]
  ): Promise<string>;
  createThreePaneSession(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[],
    npmCommand?: string
  ): Promise<string>;
  createTwoPaneNpmSession(
    projectName: string,
    projectPath: string,
    npmCommand?: string
  ): Promise<string>;

  // Attachment
  attachToSession(name: string): Promise<void>;
  getAttachCommand(name: string): string;

  // Shell command generation (for --shell mode)
  buildShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[]
  ): string[];
  buildThreePaneShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs?: string[],
    npmCommand?: string
  ): string[];
  buildTwoPaneNpmShellCommands(
    projectName: string,
    projectPath: string,
    npmCommand?: string
  ): string[];
}

/**
 * Detect the best available terminal multiplexer.
 *
 * Priority:
 * 1. If running inside cmux (CMUX_WORKSPACE_ID or CMUX_SURFACE_ID set), use CmuxManager
 * 2. If tmux is available, use TmuxManager
 * 3. Otherwise, return null
 */
export async function detectMultiplexer(): Promise<TerminalMultiplexer | null> {
  // Check if running inside cmux
  if (process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID) {
    const cmux = new CmuxManager();
    if (await cmux.isAvailable()) {
      return cmux;
    }
  }

  // Fall back to tmux
  const tmux = new TmuxManager();
  if (await tmux.isAvailable()) {
    return tmux;
  }

  return null;
}
```

- [ ] **Step 4: Create a stub CmuxManager so imports resolve**

Create a minimal `src/lib/cmux.ts` with just enough to compile:

```typescript
// src/lib/cmux.ts
import { sanitizeForShell } from './sanitize.js';
import type { TerminalMultiplexer } from './multiplexer.js';

export class CmuxManager implements TerminalMultiplexer {
  readonly name = 'cmux';
  private sessionPrefix = 'workon-';

  async isAvailable(): Promise<boolean> {
    // TODO: implement in Task 8
    return false;
  }

  async sessionExists(_name: string): Promise<boolean> {
    throw new Error('CmuxManager not yet implemented');
  }

  getSessionName(projectName: string): string {
    return `${this.sessionPrefix}${sanitizeForShell(projectName)}`;
  }

  getWorktreeSessionName(projectName: string, worktreeName: string): string {
    return `${this.sessionPrefix}${sanitizeForShell(projectName)}-${sanitizeForShell(worktreeName)}`;
  }

  async killSession(_name: string): Promise<boolean> {
    throw new Error('CmuxManager not yet implemented');
  }

  async listWorkonSessions(): Promise<string[]> {
    throw new Error('CmuxManager not yet implemented');
  }

  async createSplitSession(
    _projectName: string,
    _projectPath: string,
    _claudeArgs?: string[]
  ): Promise<string> {
    throw new Error('CmuxManager not yet implemented');
  }

  async createThreePaneSession(
    _projectName: string,
    _projectPath: string,
    _claudeArgs?: string[],
    _npmCommand?: string
  ): Promise<string> {
    throw new Error('CmuxManager not yet implemented');
  }

  async createTwoPaneNpmSession(
    _projectName: string,
    _projectPath: string,
    _npmCommand?: string
  ): Promise<string> {
    throw new Error('CmuxManager not yet implemented');
  }

  async attachToSession(_name: string): Promise<void> {
    throw new Error('CmuxManager not yet implemented');
  }

  getAttachCommand(_name: string): string {
    throw new Error('CmuxManager not yet implemented');
  }

  buildShellCommands(
    _projectName: string,
    _projectPath: string,
    _claudeArgs?: string[]
  ): string[] {
    throw new Error('CmuxManager not yet implemented');
  }

  buildThreePaneShellCommands(
    _projectName: string,
    _projectPath: string,
    _claudeArgs?: string[],
    _npmCommand?: string
  ): string[] {
    throw new Error('CmuxManager not yet implemented');
  }

  buildTwoPaneNpmShellCommands(
    _projectName: string,
    _projectPath: string,
    _npmCommand?: string
  ): string[] {
    throw new Error('CmuxManager not yet implemented');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/multiplexer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/multiplexer.ts src/lib/cmux.ts tests/multiplexer.test.ts
git commit -m "feat: add TerminalMultiplexer interface and detectMultiplexer factory"
```

---

### Task 2: Make TmuxManager implement TerminalMultiplexer

**Files:**
- Modify: `src/lib/tmux.ts`
- Modify: `tests/lib/tmux.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/tmux.test.ts`:

```typescript
it('should have name property set to tmux', () => {
  expect(tmux.name).toBe('tmux');
});

it('should implement isAvailable method', async () => {
  const result = await tmux.isAvailable();
  expect(typeof result).toBe('boolean');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/tmux.test.ts`
Expected: FAIL — `name` property does not exist, `isAvailable` not found

- [ ] **Step 3: Update TmuxManager to implement TerminalMultiplexer**

In `src/lib/tmux.ts`:

1. Add import: `import type { TerminalMultiplexer } from './multiplexer.js';`
2. Change class declaration: `export class TmuxManager implements TerminalMultiplexer {`
3. Add `readonly name = 'tmux';` as first class property
4. Add `isAvailable()` as an alias for `isTmuxAvailable()`:
```typescript
async isAvailable(): Promise<boolean> {
  return this.isTmuxAvailable();
}
```
5. Change `private getAttachCommand` to `getAttachCommand` (remove `private` — interface requires public)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/tmux.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/tmux.ts tests/lib/tmux.test.ts
git commit -m "feat: make TmuxManager implement TerminalMultiplexer interface"
```

---

## Chunk 2: Event system renames

### Task 3: Rename EventTmux, requiresTmux, and related symbols

This is a mechanical find-and-replace across many files. Do it all in one task to keep the codebase consistent.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/events/base.ts`
- Modify: `src/events/registry.ts`
- Modify: `src/events/extensions/claude.ts`
- Modify: `src/events/extensions/npm.ts`
- Modify: `src/events/extensions/docker.ts`
- Modify: `src/events/core/cwd.ts`
- Modify: `src/events/core/ide.ts`
- Modify: `src/events/core/web.ts`
- Modify: `tests/events/registry.test.ts`
- Modify: `tests/events/base.test.ts`
- Modify: `tests/events/core/cwd.test.ts`
- Modify: `tests/events/core/ide.test.ts`
- Modify: `tests/events/core/web.test.ts`
- Modify: `tests/events/extensions/claude.test.ts`
- Modify: `tests/events/extensions/npm.test.ts`
- Modify: `tests/events/extensions/docker.test.ts`

- [ ] **Step 1: Rename in types/index.ts**

In `src/types/index.ts`:
- `EventTmux` → `EventMultiplexer` (interface name, line 82)
- `requiresTmux` → `requiresMultiplexer` (in EventMetadata, line 58)
- `tmux?: EventTmux | null` → `multiplexer?: EventMultiplexer | null` (in EventHandler, line 98)
- `readonly tmux?: EventTmux | null` → `readonly multiplexer?: EventMultiplexer | null` (in EventHandlerClass, line 112)

- [ ] **Step 2: Rename in events/base.ts**

In `src/events/base.ts`:
- Import `EventMultiplexer` instead of `EventTmux` (line 6)
- `static get tmux(): EventTmux | null` → `static get multiplexer(): EventMultiplexer | null` (line 66)
- `get tmux(): EventTmux | null` → `get multiplexer(): EventMultiplexer | null` (line 70)
- Update the instance getter body: `(this.constructor as typeof BaseEvent).tmux` → `(this.constructor as typeof BaseEvent).multiplexer` (line 71)

- [ ] **Step 3: Rename in events/registry.ts**

In `src/events/registry.ts`:
- `getTmuxEnabledEvents()` → `getMultiplexerEnabledEvents()` (line 101)
- Internal variable `tmuxEvents` → `muxEvents` (lines 104, 108, 116)
- `const tmux = eventClass.tmux` → `const mux = eventClass.multiplexer` (line 106)
- `hasTmux` → `hasMultiplexer` (lines 128, 141)
- `!!eventClass.tmux` → `!!eventClass.multiplexer` (line 141)

- [ ] **Step 4: Rename in all 6 event files**

In each of the 6 event files (`claude.ts`, `npm.ts`, `docker.ts`, `cwd.ts`, `ide.ts`, `web.ts`):
- `requiresTmux` → `requiresMultiplexer` in metadata
- `import ... EventTmux` → `import ... EventMultiplexer` (only in claude.ts and npm.ts which import it)
- `static get tmux()` → `static get multiplexer()` (in claude.ts, npm.ts, docker.ts, web.ts, cwd.ts, ide.ts — all have it via base class or explicitly)

For claude.ts specifically:
- `static get tmux(): EventTmux` → `static get multiplexer(): EventMultiplexer` (line 140)

For npm.ts specifically:
- `static get tmux(): EventTmux` → `static get multiplexer(): EventMultiplexer` (line 142)

For docker.ts, web.ts, cwd.ts, ide.ts:
- `static get tmux()` → `static get multiplexer()` (if they override it explicitly)

- [ ] **Step 5: Rename in all test files**

In each test file:
- `requiresTmux` → `requiresMultiplexer`
- `getTmuxEnabledEvents` → `getMultiplexerEnabledEvents`
- `hasTmux` → `hasMultiplexer`

Files to update:
- `tests/events/registry.test.ts` — rename method calls, `hasTmux` assertions
- `tests/events/base.test.ts` — rename `requiresTmux` in mock metadata
- `tests/events/core/cwd.test.ts` — rename assertion
- `tests/events/core/ide.test.ts` — rename assertion
- `tests/events/core/web.test.ts` — rename assertion
- `tests/events/extensions/claude.test.ts` — rename assertion
- `tests/events/extensions/npm.test.ts` — rename assertion
- `tests/events/extensions/docker.test.ts` — rename assertion

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/events/ tests/events/
git commit -m "refactor: rename EventTmux to EventMultiplexer and requiresTmux to requiresMultiplexer"
```

---

## Chunk 3: Refactor open.ts and worktree commands

### Task 4: Refactor open.ts to use detectMultiplexer

**Files:**
- Modify: `src/commands/open.ts`
- Modify: `tests/commands/open.test.ts`

- [ ] **Step 1: Update tests/commands/open.test.ts**

Replace the TmuxManager mock with a multiplexer mock:

- Change `vi.mock('../src/lib/tmux.js', ...)` to `vi.mock('../src/lib/multiplexer.js', ...)`
- The mock should make `detectMultiplexer()` return a mock object implementing `TerminalMultiplexer`
- Keep the same mock method implementations (they test the same behavior)
- Update any assertions that reference `mockTmuxManager` to reference the multiplexer mock

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/commands/open.test.ts`
Expected: FAIL — open.ts still imports TmuxManager directly

- [ ] **Step 3: Refactor open.ts**

In `src/commands/open.ts`:

1. Replace import: `import { TmuxManager } from '../lib/tmux.js'` → `import { detectMultiplexer, type TerminalMultiplexer } from '../lib/multiplexer.js'`
2. In `handleTmuxLayout()`:
   - Rename function to `handleMultiplexerLayout()`
   - Replace `const tmux = new TmuxManager()` with parameter: accept `mux: TerminalMultiplexer | null` as first arg
   - Replace `tmux.isTmuxAvailable()` with `mux !== null`
   - Replace all `tmux.` method calls with `mux.` method calls
3. In `buildLayoutShellCommands()`:
   - Change param type from `tmux: TmuxManager` to `mux: TerminalMultiplexer`
   - Replace `tmux.` with `mux.`
4. In `createTmuxSession()`:
   - Rename to `createMultiplexerSession()`
   - Change param type from `tmux: TmuxManager` to `mux: TerminalMultiplexer`
   - Replace `tmux.` with `mux.`
5. In `handleMultiplexerLayout()` (formerly `handleTmuxLayout`):
   - Replace `const tmux = new TmuxManager()` (line 251) with `const mux = await detectMultiplexer()`
   - This is the single location where the multiplexer is instantiated — the three handler functions (`handleSplitTerminal`, `handleThreePaneLayout`, `handleTwoPaneNpmLayout`) just build `LayoutConfig` objects and delegate to `handleMultiplexerLayout()`, so they don't need changes beyond calling the renamed function
6. In `buildFallbackCommandsWithEvents()`:
   - Update warning message: `echo "⚠ No terminal multiplexer available - install tmux or use cmux" >&2`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/commands/open.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/open.ts tests/commands/open.test.ts
git commit -m "refactor: use detectMultiplexer in open.ts instead of TmuxManager directly"
```

---

### Task 5: Refactor worktrees/open.ts to use detectMultiplexer

This is the most significant worktree change — it has hardcoded tmux commands that need to delegate to the multiplexer interface.

**Files:**
- Modify: `src/commands/worktrees/open.ts`

- [ ] **Step 1: Replace TmuxManager import and instantiation**

In `src/commands/worktrees/open.ts`:

1. Replace import: `import { TmuxManager } from '../../lib/tmux.js'` → `import { detectMultiplexer, type TerminalMultiplexer } from '../../lib/multiplexer.js'`
2. In `runWorktreeOpen()`:
   - Replace `const tmux = new TmuxManager()` with `const mux = await detectMultiplexer()`
   - Replace `tmux.getWorktreeSessionName(...)` with `mux?.getWorktreeSessionName(...) ?? ''`
   - Guard all mux calls with null checks
   - Replace `tmux.isTmuxAvailable()` with `mux !== null`
   - Replace error message `'tmux is not available. Install with: brew install tmux'` with `'No terminal multiplexer available. Install tmux or use cmux.'`
   - Replace `console.log(chalk.cyan(`  tmux attach ...`))` with `console.log(chalk.cyan(`  ${mux.getAttachCommand(sessionName)}`))`
   - Replace user-facing strings: `"in tmux session"` → `"in session"`, `"Created tmux session"` → `"Created session"`

- [ ] **Step 2: Refactor buildWorktreeShellCommands to use multiplexer methods**

Replace the function signature:
```typescript
async function buildWorktreeShellCommands(
  project: Project | null,
  worktreePath: string,
  sessionName: string,
  mux: TerminalMultiplexer,
  eventFlags: { hasClaudeEvent: boolean; hasNpmEvent: boolean }
): Promise<string[]>
```

Replace the body to delegate to `mux.buildShellCommands()`, `mux.buildThreePaneShellCommands()`, and `mux.buildTwoPaneNpmShellCommands()` instead of calling the local hardcoded builders.

For the "simple session" case (no claude, no npm), add a `buildSimpleSessionShellCommands()` method call. Since the interface doesn't have this, build it inline using `mux.getSessionName()` and `mux.getAttachCommand()`.

- [ ] **Step 3: Refactor createWorktreeTmuxSession to use multiplexer methods**

Replace the function to delegate to `mux.createSplitSession()`, `mux.createThreePaneSession()`, `mux.createTwoPaneNpmSession()` instead of calling local hardcoded functions.

For the "simple session" case, keep it inline but use the multiplexer interface.

- [ ] **Step 4: Remove the hardcoded tmux command functions**

Delete these local functions (they are now handled by the multiplexer):
- `buildSimpleSessionCommands()` (lines 235-249)
- `buildSplitClaudeCommands()` (lines 251-270)
- `buildTwoPaneNpmCommands()` (lines 272-290)
- `buildThreePaneCommands()` (lines 292-315)
- `getAttachCommand()` (lines 317-334)
- `createSimpleSession()` (lines 342-347)
- `createSplitClaudeSession()` (lines 349-364)
- `createTwoPaneNpmSession()` (lines 366-378)
- `createThreePaneSession()` (lines 380-401)
- `wrapWithShellFallback()` (lines 231-233)
- The `exec` import and promisify (lines 337-340)
- The `escapeForSingleQuotes` import (line 229)

**Handling the "simple session" case (no claude, no npm):**

The `TerminalMultiplexer` interface does not have a `createSimpleSession` method. For this case, keep a minimal local helper that branches on `mux.name`:

```typescript
function buildSimpleSessionCommands(
  sessionName: string,
  worktreePath: string,
  mux: TerminalMultiplexer
): string[] {
  if (mux.name === 'cmux') {
    return [
      `# Create cmux workspace for worktree`,
      `cmux new-workspace`,
    ];
  }
  // tmux fallback
  const escapedSession = escapeForSingleQuotes(sessionName);
  const escapedPath = escapeForSingleQuotes(worktreePath);
  return [
    `# Create tmux session for worktree`,
    `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
    `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`,
    mux.getAttachCommand(sessionName),
  ];
}
```

Keep the `escapeForSingleQuotes` import for this one function. Similarly, for the direct-mode `createSimpleSession`, branch on `mux.name` to either use `cmux new-workspace` or `tmux new-session`.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/worktrees/open.ts
git commit -m "refactor: use detectMultiplexer in worktrees/open.ts, remove hardcoded tmux commands"
```

---

### Task 6: Refactor worktree.ts, merge.ts, remove.ts

These files only use `TmuxManager` for `killSession()` — simple swaps.

**Files:**
- Modify: `src/commands/worktree.ts`
- Modify: `src/commands/worktrees/merge.ts`
- Modify: `src/commands/worktrees/remove.ts`

- [ ] **Step 1: Update worktree.ts**

In `src/commands/worktree.ts`:
1. Replace import: `import { TmuxManager } from '../lib/tmux.js'` → `import { detectMultiplexer } from '../lib/multiplexer.js'`
2. In `mergeCurrentWorktree()` (line 277):
   - Replace:
     ```typescript
     const tmux = new TmuxManager();
     const sessionName = tmux.getWorktreeSessionName(...);
     if (await tmux.sessionExists(sessionName)) {
       await tmux.killSession(sessionName);
     }
     ```
   - With:
     ```typescript
     const mux = await detectMultiplexer();
     if (mux) {
       const sessionName = mux.getWorktreeSessionName(...);
       if (await mux.sessionExists(sessionName)) {
         await mux.killSession(sessionName);
       }
     }
     ```

- [ ] **Step 2: Update merge.ts**

In `src/commands/worktrees/merge.ts`:
1. Replace import: `import { TmuxManager } from '../../lib/tmux.js'` → `import { detectMultiplexer } from '../../lib/multiplexer.js'`
2. In the merge action (line 156):
   - Same pattern: `const mux = await detectMultiplexer()` then null-guard

- [ ] **Step 3: Update remove.ts**

In `src/commands/worktrees/remove.ts`:
1. Replace import: `import { TmuxManager } from '../../lib/tmux.js'` → `import { detectMultiplexer } from '../../lib/multiplexer.js'`
2. In the remove action (line 119):
   - Same pattern: `const mux = await detectMultiplexer()` then null-guard

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/worktree.ts src/commands/worktrees/merge.ts src/commands/worktrees/remove.ts
git commit -m "refactor: use detectMultiplexer in worktree/merge/remove commands"
```

---

### Task 7: Update remaining test mocks and public exports

**Files:**
- Modify: `tests/commands/cli-index.test.ts`
- Modify: `tests/commands/interactive.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update cli-index.test.ts mock**

Replace:
```typescript
vi.mock('../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => ({...})),
}));
```
With a mock of `../src/lib/multiplexer.js` if open.ts now imports from there, or keep the tmux mock if these tests don't exercise the multiplexer path. Check if the test still needs the mock — if it does, update the mock target to match the new import in open.ts.

- [ ] **Step 2: Update interactive.test.ts mock**

Same pattern as Step 1.

- [ ] **Step 3: Update src/index.ts**

Add exports:
```typescript
export { detectMultiplexer } from './lib/multiplexer.js';
export type { TerminalMultiplexer } from './lib/multiplexer.js';
```

Keep the existing `TmuxManager` export for backwards compatibility.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Run type-check and lint**

Run: `pnpm run type-check && pnpm run lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add tests/commands/cli-index.test.ts tests/commands/interactive.test.ts src/index.ts
git commit -m "refactor: update test mocks and public exports for multiplexer abstraction"
```

---

## Chunk 4: CmuxManager implementation

### Task 8: Implement CmuxManager — availability and session management

**Files:**
- Modify: `src/lib/cmux.ts`
- Create: `tests/cmux.test.ts`

- [ ] **Step 1: Write failing tests for availability and session management**

```typescript
// tests/cmux.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CmuxManager } from '../src/lib/cmux.js';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec as execCallback } from 'child_process';

const mockExec = vi.mocked(execCallback);

describe('CmuxManager', () => {
  let cmux: CmuxManager;

  beforeEach(() => {
    cmux = new CmuxManager();
    vi.clearAllMocks();
  });

  describe('name', () => {
    it('should return cmux', () => {
      expect(cmux.name).toBe('cmux');
    });
  });

  describe('isAvailable', () => {
    it('should return true when cmux ping succeeds', async () => {
      mockExec.mockImplementation((_cmd, callback: any) => {
        callback(null, { stdout: 'pong', stderr: '' });
        return {} as any;
      });
      expect(await cmux.isAvailable()).toBe(true);
    });

    it('should return false when cmux ping fails', async () => {
      mockExec.mockImplementation((_cmd, callback: any) => {
        callback(new Error('Connection refused'), { stdout: '', stderr: '' });
        return {} as any;
      });
      expect(await cmux.isAvailable()).toBe(false);
    });
  });

  describe('getSessionName', () => {
    it('should return prefixed name', () => {
      expect(cmux.getSessionName('myproject')).toBe('workon-myproject');
    });
  });

  describe('getWorktreeSessionName', () => {
    it('should return prefixed name with worktree', () => {
      expect(cmux.getWorktreeSessionName('proj', 'feat')).toBe('workon-proj-feat');
    });
  });

  describe('sessionExists', () => {
    it('should return true when workspace is found', async () => {
      mockExec.mockImplementation((_cmd, callback: any) => {
        callback(null, {
          stdout: JSON.stringify([
            { id: '1', title: 'workon-myproject' },
            { id: '2', title: 'other' },
          ]),
          stderr: '',
        });
        return {} as any;
      });
      expect(await cmux.sessionExists('workon-myproject')).toBe(true);
    });

    it('should return false when workspace not found', async () => {
      mockExec.mockImplementation((_cmd, callback: any) => {
        callback(null, {
          stdout: JSON.stringify([{ id: '2', title: 'other' }]),
          stderr: '',
        });
        return {} as any;
      });
      expect(await cmux.sessionExists('workon-myproject')).toBe(false);
    });
  });

  describe('killSession', () => {
    it('should return true on success', async () => {
      // First call: list-workspaces to find the ID
      // Second call: close-workspace
      let callCount = 0;
      mockExec.mockImplementation((_cmd, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(null, {
            stdout: JSON.stringify([{ id: 'ws-1', title: 'workon-myproject' }]),
            stderr: '',
          });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });
      expect(await cmux.killSession('workon-myproject')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cmux.test.ts`
Expected: FAIL — stub methods throw "not yet implemented"

- [ ] **Step 3: Implement availability and session management in CmuxManager**

In `src/lib/cmux.ts`, replace the stub implementations:

```typescript
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { sanitizeForShell } from './sanitize.js';
import type { TerminalMultiplexer } from './multiplexer.js';

const exec = promisify(execCallback);

interface CmuxWorkspace {
  id: string;
  title: string;
}

export class CmuxManager implements TerminalMultiplexer {
  readonly name = 'cmux';
  private sessionPrefix = 'workon-';

  async isAvailable(): Promise<boolean> {
    try {
      await exec('cmux ping');
      return true;
    } catch {
      return false;
    }
  }

  async sessionExists(name: string): Promise<boolean> {
    const workspaces = await this.listWorkspaces();
    return workspaces.some((ws) => ws.title === name);
  }

  getSessionName(projectName: string): string {
    return `${this.sessionPrefix}${sanitizeForShell(projectName)}`;
  }

  getWorktreeSessionName(projectName: string, worktreeName: string): string {
    const sanitizedProject = sanitizeForShell(projectName);
    const sanitizedWorktree = sanitizeForShell(worktreeName);
    return `${this.sessionPrefix}${sanitizedProject}-${sanitizedWorktree}`;
  }

  async killSession(name: string): Promise<boolean> {
    try {
      const workspaces = await this.listWorkspaces();
      const workspace = workspaces.find((ws) => ws.title === name);
      if (!workspace) return false;
      await exec(`cmux close-workspace --workspace '${workspace.id}'`);
      return true;
    } catch {
      return false;
    }
  }

  async listWorkonSessions(): Promise<string[]> {
    try {
      const workspaces = await this.listWorkspaces();
      return workspaces
        .filter((ws) => ws.title.startsWith(this.sessionPrefix))
        .map((ws) => ws.title.replace(this.sessionPrefix, ''));
    } catch {
      return [];
    }
  }

  private async listWorkspaces(): Promise<CmuxWorkspace[]> {
    try {
      const { stdout } = await exec('cmux list-workspaces --json');
      return JSON.parse(stdout) as CmuxWorkspace[];
    } catch {
      return [];
    }
  }

  // ... layout methods will be implemented in next task
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cmux.test.ts`
Expected: PASS for the availability and session management tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/cmux.ts tests/cmux.test.ts
git commit -m "feat: implement CmuxManager availability and session management"
```

---

### Task 9: Implement CmuxManager — layout creation

**Files:**
- Modify: `src/lib/cmux.ts`
- Modify: `tests/cmux.test.ts`

- [ ] **Step 1: Write failing tests for createSplitSession**

Add to `tests/cmux.test.ts`:

```typescript
describe('createSplitSession', () => {
  it('should create a workspace and split pane', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation((cmd: any, callback: any) => {
      commands.push(typeof cmd === 'string' ? cmd : cmd.toString());
      // Mock identify responses
      if (cmd.includes('identify')) {
        callback(null, { stdout: JSON.stringify({ surfaceId: `surface-${commands.length}` }), stderr: '' });
      } else if (cmd.includes('list-workspaces')) {
        callback(null, { stdout: JSON.stringify([]), stderr: '' });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as any;
    });

    const sessionName = await cmux.createSplitSession('myproject', '/path/to/project', ['--dangerously-skip-permissions']);
    expect(sessionName).toBe('workon-myproject');
    expect(commands.some(c => c.includes('new-workspace'))).toBe(true);
    expect(commands.some(c => c.includes('new-split'))).toBe(true);
    expect(commands.some(c => c.includes('send-surface'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cmux.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement layout creation methods**

In `src/lib/cmux.ts`, implement:

```typescript
private async getCurrentSurfaceId(): Promise<string> {
  const { stdout } = await exec('cmux identify --json');
  const info = JSON.parse(stdout);
  return info.surfaceId;
}

async createSplitSession(
  projectName: string,
  projectPath: string,
  claudeArgs: string[] = []
): Promise<string> {
  const sessionName = this.getSessionName(projectName);

  // Kill existing session if it exists
  if (await this.sessionExists(sessionName)) {
    await this.killSession(sessionName);
  }

  // Create new workspace with the project's working directory
  // cmux inherits cwd from the calling process, but we should be explicit
  // since workon may not have cd'd yet. Use --cwd if supported, otherwise
  // the caller (open.ts) ensures cwd is set before calling.
  await exec(`cmux new-workspace`);

  // Get the initial surface ID (left pane)
  const leftSurfaceId = await this.getCurrentSurfaceId();

  // Split right to create second pane
  await exec('cmux new-split right');
  // New pane is now focused — this is the right pane (shell)

  // Send claude command to the left pane
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  await exec(`cmux send-surface '${leftSurfaceId}' '${claudeCommand}'`);
  await exec(`cmux send-key-surface '${leftSurfaceId}' enter`);

  // Focus left pane (claude)
  await exec(`cmux focus-surface --surface '${leftSurfaceId}'`);

  return sessionName;
}

async createThreePaneSession(
  projectName: string,
  projectPath: string,
  claudeArgs: string[] = [],
  npmCommand = 'npm run dev'
): Promise<string> {
  const sessionName = this.getSessionName(projectName);

  if (await this.sessionExists(sessionName)) {
    await this.killSession(sessionName);
  }

  await exec(`cmux new-workspace`);
  const leftSurfaceId = await this.getCurrentSurfaceId();

  // Split right
  await exec('cmux new-split right');
  const topRightSurfaceId = await this.getCurrentSurfaceId();

  // Split the right pane down
  await exec('cmux new-split down');
  const bottomRightSurfaceId = await this.getCurrentSurfaceId();

  // Send claude to left pane
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
  await exec(`cmux send-surface '${leftSurfaceId}' '${claudeCommand}'`);
  await exec(`cmux send-key-surface '${leftSurfaceId}' enter`);

  // Send npm to bottom-right pane
  await exec(`cmux send-surface '${bottomRightSurfaceId}' '${npmCommand}'`);
  await exec(`cmux send-key-surface '${bottomRightSurfaceId}' enter`);

  // Focus left pane (claude)
  await exec(`cmux focus-surface --surface '${leftSurfaceId}'`);

  return sessionName;
}

async createTwoPaneNpmSession(
  projectName: string,
  projectPath: string,
  npmCommand = 'npm run dev'
): Promise<string> {
  const sessionName = this.getSessionName(projectName);

  if (await this.sessionExists(sessionName)) {
    await this.killSession(sessionName);
  }

  await exec(`cmux new-workspace`);
  const leftSurfaceId = await this.getCurrentSurfaceId();

  // Split right
  await exec('cmux new-split right');
  const rightSurfaceId = await this.getCurrentSurfaceId();

  // Send npm to right pane
  await exec(`cmux send-surface '${rightSurfaceId}' '${npmCommand}'`);
  await exec(`cmux send-key-surface '${rightSurfaceId}' enter`);

  // Focus left pane (shell)
  await exec(`cmux focus-surface --surface '${leftSurfaceId}'`);

  return sessionName;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cmux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cmux.ts tests/cmux.test.ts
git commit -m "feat: implement CmuxManager layout creation methods"
```

---

### Task 10: Implement CmuxManager — attachment and shell commands

**Files:**
- Modify: `src/lib/cmux.ts`
- Modify: `tests/cmux.test.ts`

- [ ] **Step 1: Write failing tests for attachment and shell command generation**

Add to `tests/cmux.test.ts`:

```typescript
describe('attachToSession', () => {
  it('should select the workspace', async () => {
    let executedCmd = '';
    // list-workspaces then select-workspace
    let callCount = 0;
    mockExec.mockImplementation((cmd: any, callback: any) => {
      callCount++;
      if (callCount === 1) {
        callback(null, {
          stdout: JSON.stringify([{ id: 'ws-1', title: 'workon-myproject' }]),
          stderr: '',
        });
      } else {
        executedCmd = typeof cmd === 'string' ? cmd : cmd.toString();
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as any;
    });
    await cmux.attachToSession('workon-myproject');
    expect(executedCmd).toContain('select-workspace');
  });
});

describe('getAttachCommand', () => {
  it('should return cmux select-workspace command', () => {
    const cmd = cmux.getAttachCommand('workon-myproject');
    expect(cmd).toContain('cmux select-workspace');
    expect(cmd).toContain('workon-myproject');
  });
});

describe('buildShellCommands', () => {
  it('should return cmux commands for split layout', () => {
    const commands = cmux.buildShellCommands('myproject', '/path', ['--dangerously-skip-permissions']);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(c => c.includes('cmux new-workspace'))).toBe(true);
    expect(commands.some(c => c.includes('cmux new-split'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cmux.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement attachment and shell command methods**

In `src/lib/cmux.ts`:

```typescript
async attachToSession(name: string): Promise<void> {
  const workspaces = await this.listWorkspaces();
  const workspace = workspaces.find((ws) => ws.title === name);
  if (workspace) {
    await exec(`cmux select-workspace --workspace '${workspace.id}'`);
  }
}

getAttachCommand(name: string): string {
  // In shell mode, we emit cmux commands that will be eval'd
  return `cmux select-workspace --workspace "$(cmux list-workspaces --json | jq -r '.[] | select(.title=="${name}") | .id')"`;
}

buildShellCommands(
  projectName: string,
  _projectPath: string,
  claudeArgs: string[] = []
): string[] {
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

  return [
    `# Create cmux split session for ${sanitizeForShell(projectName)}`,
    `cmux new-workspace`,
    `CMUX_LEFT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux new-split right`,
    `cmux send-surface "$CMUX_LEFT_SURFACE" '${claudeCommand}'`,
    `cmux send-key-surface "$CMUX_LEFT_SURFACE" enter`,
    `cmux focus-surface --surface "$CMUX_LEFT_SURFACE"`,
  ];
}

buildThreePaneShellCommands(
  projectName: string,
  _projectPath: string,
  claudeArgs: string[] = [],
  npmCommand = 'npm run dev'
): string[] {
  const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

  return [
    `# Create cmux three-pane session for ${sanitizeForShell(projectName)}`,
    `cmux new-workspace`,
    `CMUX_LEFT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux new-split right`,
    `CMUX_TOP_RIGHT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux new-split down`,
    `CMUX_BOTTOM_RIGHT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux send-surface "$CMUX_LEFT_SURFACE" '${claudeCommand}'`,
    `cmux send-key-surface "$CMUX_LEFT_SURFACE" enter`,
    `cmux send-surface "$CMUX_BOTTOM_RIGHT_SURFACE" '${npmCommand}'`,
    `cmux send-key-surface "$CMUX_BOTTOM_RIGHT_SURFACE" enter`,
    `cmux focus-surface --surface "$CMUX_LEFT_SURFACE"`,
  ];
}

buildTwoPaneNpmShellCommands(
  projectName: string,
  _projectPath: string,
  npmCommand = 'npm run dev'
): string[] {
  return [
    `# Create cmux two-pane session with npm for ${sanitizeForShell(projectName)}`,
    `cmux new-workspace`,
    `CMUX_LEFT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux new-split right`,
    `CMUX_RIGHT_SURFACE=$(cmux identify --json | jq -r '.surfaceId')`,
    `cmux send-surface "$CMUX_RIGHT_SURFACE" '${npmCommand}'`,
    `cmux send-key-surface "$CMUX_RIGHT_SURFACE" enter`,
    `cmux focus-surface --surface "$CMUX_LEFT_SURFACE"`,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cmux.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/cmux.ts tests/cmux.test.ts
git commit -m "feat: implement CmuxManager attachment and shell command generation"
```

---

## Chunk 5: Documentation and final verification

### Task 11: Update CLAUDE.md and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`:
- Update `requiresTmux` → `requiresMultiplexer` in the event metadata documentation (line 86)
- Add `src/lib/multiplexer.ts` and `src/lib/cmux.ts` to the directory structure in the Architecture section
- Update the "Tmux Layouts" section header to "Multiplexer Layouts" and note that both tmux and cmux are supported

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm run type-check && pnpm run lint`
Expected: No errors

- [ ] **Step 4: Run build**

Run: `pnpm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for multiplexer terminology"
```

- [ ] **Step 6: Final smoke test**

Run: `node bin/workon --debug` to verify the CLI still loads correctly.
Expected: CLI help output displays without errors.
