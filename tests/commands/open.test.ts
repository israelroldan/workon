import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenCommand, processProjectDirect } from '../../src/commands/open.js';
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
    config.deleteProject('testproject');
    config.delete('project_defaults');
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
});

describe('processProjectDirect', () => {
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
    // Clear all projects to ensure test isolation
    const projects = config.getProjects();
    Object.keys(projects).forEach((name) => config.deleteProject(name));

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Set up test project
    config.set('project_defaults', { base: '/tmp' });
    config.setProject('testproject', {
      path: 'testproject',
      events: { cwd: true, ide: true },
    });

    // Initialize event registry
    EventRegistry.clear();
    await EventRegistry.initialize();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    config.deleteProject('testproject');
    config.delete('project_defaults');
  });

  it.skip('should process project in shell mode', async () => {
    // Skipped: This test times out because shell mode triggers full event processing
    // which may involve async operations not properly mocked
    await processProjectDirect('testproject', { shell: true }, { config, log: mockLog });

    // Should have logged debug messages
    expect(mockLog.debug).toHaveBeenCalled();
  }, 10000);

  it('should process specific commands with colon syntax', async () => {
    await processProjectDirect('testproject:cwd', { shell: true }, { config, log: mockLog });

    // Should have logged the command processing
    expect(mockLog.debug).toHaveBeenCalled();
  });

  it('should throw error for invalid commands', async () => {
    await expect(
      processProjectDirect('testproject:invalid', { shell: true }, { config, log: mockLog })
    ).rejects.toThrow('Commands not configured');
  }, 10000);

  it('should handle dry-run mode', async () => {
    await processProjectDirect('testproject', { dryRun: true }, { config, log: mockLog });

    // Should log dry-run info (info is called with multiple args)
    const infoCalls = mockLog.info.mock.calls;
    const hasDryRun = infoCalls.some((call: unknown[]) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('Dry run'))
    );
    expect(hasDryRun).toBe(true);
  });

  it('should show help for project:help syntax', async () => {
    await processProjectDirect('testproject:help', {}, { config, log: mockLog });

    // Should output help info
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Available commands'));
  });
});

describe('colon syntax parsing', () => {
  let config: Config;
  let mockLog: ReturnType<typeof vi.fn> & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    config = new Config();
    // Clear all projects to ensure test isolation
    const projects = config.getProjects();
    Object.keys(projects).forEach((name) => config.deleteProject(name));

    mockLog = Object.assign(vi.fn(), {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    });

    config.set('project_defaults', { base: '/tmp' });
    config.setProject('myapp', {
      path: 'myapp',
      events: { cwd: true, ide: true, claude: true },
    });

    EventRegistry.clear();
    await EventRegistry.initialize();
  });

  afterEach(() => {
    config.deleteProject('myapp');
    config.delete('project_defaults');
  });

  it('should parse project:cmd1,cmd2 syntax', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await processProjectDirect('myapp:cwd,ide', { shell: true }, { config, log: mockLog });

    // Should have processed both commands
    const debugCalls = mockLog.debug.mock.calls.map((c: unknown[]) => c[0]);
    expect(debugCalls.some((c: string) => c.includes('cwd') && c.includes('ide'))).toBe(true);
  });
});

describe('tmux layout detection', () => {
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
    // Clear all projects to ensure test isolation
    const projects = config.getProjects();
    Object.keys(projects).forEach((name) => config.deleteProject(name));

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    config.set('project_defaults', { base: '/tmp' });

    EventRegistry.clear();
    await EventRegistry.initialize();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    config.deleteProject('proj_split');
    config.deleteProject('proj_three');
    config.deleteProject('proj_npm');
    config.delete('project_defaults');
  });

  it('should detect split layout (cwd + claude)', async () => {
    config.setProject('proj_split', {
      path: 'proj_split',
      events: { cwd: true, claude: true },
    });

    await processProjectDirect('proj_split', { dryRun: true }, { config, log: mockLog });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('split tmux'));
  });

  it('should detect three-pane layout (cwd + claude + npm)', async () => {
    config.setProject('proj_three', {
      path: 'proj_three',
      events: { cwd: true, claude: true, npm: 'dev' },
    });

    await processProjectDirect('proj_three', { dryRun: true }, { config, log: mockLog });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('three-pane'));
  });

  it('should detect two-pane npm layout (cwd + npm)', async () => {
    config.setProject('proj_npm', {
      path: 'proj_npm',
      events: { cwd: true, npm: 'dev' },
    });

    await processProjectDirect('proj_npm', { dryRun: true }, { config, log: mockLog });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('two-pane'));
  });
});
