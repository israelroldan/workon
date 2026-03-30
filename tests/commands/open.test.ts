import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenCommand } from '../../src/commands/open.js';
import { Config } from '../../src/lib/config.js';
import { EventRegistry } from '../../src/events/registry.js';

// Mock TmuxManager to avoid actual tmux calls
const mockTmuxManager = {
  isTmuxAvailable: vi.fn().mockResolvedValue(false),
  getSessionName: vi.fn((name: string) => `workon-${name}`),
  buildShellCommands: vi.fn(() => ['# mock tmux commands']),
  buildThreePaneShellCommands: vi.fn(() => ['# mock three-pane commands']),
  buildTwoPaneNpmShellCommands: vi.fn(() => ['# mock two-pane npm commands']),
  createSplitSession: vi.fn().mockResolvedValue('workon-test'),
  createThreePaneSession: vi.fn().mockResolvedValue('workon-test'),
  createTwoPaneNpmSession: vi.fn().mockResolvedValue('workon-test'),
  attachToSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => mockTmuxManager),
}));

// Mock child_process to avoid actual spawns
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  exec: vi.fn((_cmd: string, cb: (err: null, result: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout: '', stderr: '' })
  ),
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

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test projects
    try {
      config.deleteProject('testproject');
      config.deleteProject('myproject');
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

describe('colon syntax parsing', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    config = new Config();
    config.set('project_defaults', { base: '/tmp' });
    config.setProject('myproject', {
      path: 'myproject',
      ide: 'vscode',
      events: { cwd: true, ide: true, claude: true },
    });

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    EventRegistry.clear();
    await EventRegistry.initialize();
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('myproject');
      config.delete('project_defaults');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should parse project:help syntax and show available commands', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'myproject:help']);

    // Should have logged available commands
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('myproject');
  });

  it('should parse project:command syntax', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    // Run with just cwd command
    await cmd.parseAsync(['node', 'test', 'myproject:cwd', '--dry-run']);

    // Should log that it would execute cwd
    expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('cwd'));
  });

  it('should parse project:cmd1,cmd2 syntax', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'myproject:cwd,ide', '--dry-run']);

    // Should log both commands
    const debugCalls = mockLog.debug.mock.calls.map((c) => c[0]).join(' ');
    expect(debugCalls).toContain('cwd');
  });

  it('should throw error for invalid commands', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await expect(cmd.parseAsync(['node', 'test', 'myproject:invalidcmd'])).rejects.toThrow(
      /not configured/
    );
  });

  it('should auto-add cwd dependency for claude command', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'myproject:claude', '--dry-run']);

    // Should have added cwd automatically
    const debugCalls = mockLog.debug.mock.calls.map((c) => c[0]).join(' ');
    expect(debugCalls).toContain('cwd');
  });
});

describe('layout detection', () => {
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
    config.set('project_defaults', { base: '/tmp' });

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    EventRegistry.clear();
    await EventRegistry.initialize();
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      config.deleteProject('testproject');
      config.delete('project_defaults');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should detect split-claude layout for cwd + claude', async () => {
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true, claude: true },
    });

    const cmd = createOpenCommand({ config, log: mockLog });
    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('split tmux session'));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Claude'));
  });

  it('should detect three-pane layout for cwd + claude + npm', async () => {
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true, claude: true, npm: 'dev' },
    });

    const cmd = createOpenCommand({ config, log: mockLog });
    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('three-pane'));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Claude'));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('NPM'));
  });

  it('should detect two-pane-npm layout for cwd + npm', async () => {
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true, npm: 'dev' },
    });

    const cmd = createOpenCommand({ config, log: mockLog });
    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('two-pane'));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('NPM'));
  });

  it('should use normal processing for events without special layout', async () => {
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true, ide: true },
    });

    const cmd = createOpenCommand({ config, log: mockLog });
    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    // Should log dry run with events but no tmux layout message
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run'),
      expect.stringContaining('cwd')
    );
  });
});

describe('dry-run mode', () => {
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
    config.set('project_defaults', { base: '/tmp' });
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true, ide: true, claude: true },
    });

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    EventRegistry.clear();
    await EventRegistry.initialize();
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      config.deleteProject('testproject');
      config.delete('project_defaults');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should not execute events in dry-run mode', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    // TmuxManager methods should not have been called for actual session creation
    expect(mockTmuxManager.createSplitSession).not.toHaveBeenCalled();
    expect(mockTmuxManager.attachToSession).not.toHaveBeenCalled();
  });

  it('should log what would be executed in dry-run mode', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    // Should have logged dry run info
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Would create'));
  });

  it('should show events that would be executed', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'testproject', '--dry-run']);

    // Should log what events would be executed
    const infoCalls = mockLog.info.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(infoCalls).toMatch(/dry run|would/i);
  });

  it('should work with colon syntax in dry-run mode', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'testproject:cwd', '--dry-run']);

    // Should not throw and should log dry run
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run'),
      expect.stringContaining('cwd')
    );
  });
});

describe('shell mode', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    config = new Config();
    config.set('project_defaults', { base: '/tmp' });
    config.setProject('testproject', {
      path: 'testproject',
      ide: 'vscode',
      events: { cwd: true },
    });

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    EventRegistry.clear();
    await EventRegistry.initialize();
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('testproject');
      config.delete('project_defaults');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should output shell commands in shell mode', async () => {
    const cmd = createOpenCommand({ config, log: mockLog });

    await cmd.parseAsync(['node', 'test', 'testproject', '--shell']);

    // Should have output shell commands
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('pushd');
  });
});
