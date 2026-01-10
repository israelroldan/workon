import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenCommand } from '../../src/commands/open.js';
import { Config } from '../../src/lib/config.js';
import { EventRegistry } from '../../src/events/registry.js';

// Mock TmuxManager to avoid actual tmux calls
vi.mock('../../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => ({
    isTmuxAvailable: vi.fn().mockResolvedValue(false),
    getSessionName: vi.fn((name: string) => `workon-${name}`),
    buildShellCommands: vi.fn(() => ['# mock tmux commands']),
    buildThreePaneShellCommands: vi.fn(() => ['# mock three-pane commands']),
    buildTwoPaneNpmShellCommands: vi.fn(() => ['# mock two-pane npm commands']),
  })),
}));

// Mock child_process to avoid actual spawns
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

describe('createOpenCommand', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    config = new Config();
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    // Initialize event registry
    EventRegistry.clear();
    await EventRegistry.initialize();
  });

  afterEach(() => {
    // Clean up test projects
    try {
      config.deleteProject('testproject');
      config.delete('project_defaults');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create a command named "open"', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('open');
  });

  it('should have description', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('project');
  });

  it('should have debug option', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    const debugOpt = cmd.options.find((o) => o.long === '--debug');
    expect(debugOpt).toBeDefined();
  });

  it('should have dry-run option', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    const dryRunOpt = cmd.options.find((o) => o.long === '--dry-run');
    expect(dryRunOpt).toBeDefined();
  });

  it('should have shell option', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    const shellOpt = cmd.options.find((o) => o.long === '--shell');
    expect(shellOpt).toBeDefined();
  });

  it('should have project argument', () => {
    const cmd = createOpenCommand({ config, log: mockLog });
    expect(cmd.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(cmd.registeredArguments[0].name()).toBe('project');
  });
});
