import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/lib/config.js';
import { BaseEnvironment, ProjectEnvironment } from '../../src/lib/environment.js';

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const { mockSelect, mockInput, mockCheckbox, mockConfirm } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
  mockCheckbox: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  select: mockSelect,
  input: mockInput,
  checkbox: mockCheckbox,
  confirm: mockConfirm,
}));

// Mock TmuxManager to avoid actual tmux calls
vi.mock('../../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => ({
    isTmuxAvailable: vi.fn().mockResolvedValue(false),
    getSessionName: vi.fn((name: string) => `workon-${name}`),
    buildShellCommands: vi.fn(() => ['# mock tmux commands']),
  })),
}));

// Mock child_process to avoid actual spawns
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    on: vi.fn((event: string, callback: () => void) => {
      // Immediately call close callback to simulate shell exit
      if (event === 'close') {
        setTimeout(() => callback(), 0);
      }
    }),
  })),
}));

// Import after mocking
import { runInteractive } from '../../src/commands/interactive.js';
import { EventRegistry } from '../../src/events/registry.js';

describe('interactive command', () => {
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

    // Initialize event registry before tests
    EventRegistry.clear();
    await EventRegistry.initialize();

    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset all mocks
    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('testproj');
      config.deleteProject('newproj');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('runInteractive', () => {
    it('should show logo and exit when exit is selected', async () => {
      mockSelect.mockResolvedValueOnce('exit');

      await runInteractive({
        config,
        log: mockLog,
        environment: new BaseEnvironment(),
      });

      // Should have shown logo (console.log called)
      expect(consoleSpy).toHaveBeenCalled();
      // Should have called select once
      expect(mockSelect).toHaveBeenCalledTimes(1);
    });

    it('should show project-specific menu when in project environment', async () => {
      mockSelect.mockResolvedValueOnce('exit');

      const projectEnv = new ProjectEnvironment({
        name: 'testproj',
        path: '/tmp/test',
        events: { cwd: true },
      });

      await runInteractive({
        config,
        log: mockLog,
        environment: projectEnv,
      });

      // Should have called select with project-specific options
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'testproj',
        })
      );
    });

    it('should show main menu when suggestedName is provided', async () => {
      mockSelect.mockResolvedValueOnce('exit');

      await runInteractive({
        config,
        log: mockLog,
        environment: new BaseEnvironment(),
        suggestedName: 'myproject',
      });

      // Should show main menu (What do you want to do?)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'What do you want to do?',
        })
      );
    });
  });

  describe('init-project flow', () => {
    it('should create a new project with user inputs', async () => {
      // First select: init-project, then exit
      mockSelect
        .mockResolvedValueOnce('init-project')
        .mockResolvedValueOnce('vscode') // IDE selection
        .mockResolvedValueOnce('exit'); // After project creation

      mockInput
        .mockResolvedValueOnce('newproj') // Project name
        .mockResolvedValueOnce('/tmp/newproj'); // Project path

      mockCheckbox.mockResolvedValueOnce(['cwd', 'ide']);

      await runInteractive({
        config,
        log: mockLog,
        environment: new BaseEnvironment(),
      });

      // Verify project was created
      const project = config.getProject('newproj');
      expect(project).toBeDefined();
      expect(project?.ide).toBe('vscode');
      expect(project?.events.cwd).toBe(true);
    });
  });
});

describe('IDE_CHOICES', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should be importable and have expected structure', async () => {
    // The IDE choices are internal, but we can verify they're used correctly
    // by checking select is called with IDE options
    mockSelect
      .mockResolvedValueOnce('init-project')
      .mockResolvedValueOnce('vscode')
      .mockResolvedValueOnce('exit');

    mockInput
      .mockResolvedValueOnce('idetest')
      .mockResolvedValueOnce('/tmp/idetest');

    mockCheckbox.mockResolvedValueOnce(['cwd']);

    const localConfig = new Config();

    const localMockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    await runInteractive({
      config: localConfig,
      log: localMockLog,
      environment: new BaseEnvironment(),
    });

    // IDE selection should include VS Code option
    const ideCall = mockSelect.mock.calls.find(
      (call: unknown[]) => (call[0] as { message: string }).message === 'What is the IDE?'
    );
    expect(ideCall).toBeDefined();
    expect((ideCall?.[0] as { choices: Array<{ value: string }> }).choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'vscode' }),
      ])
    );

    localConfig.deleteProject('idetest');
  });
});

describe('switch-project flow', () => {
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

  beforeEach(() => {
    config = new Config();
    // Clear all existing projects for clean test state
    const existingProjects = Object.keys(config.getProjects());
    existingProjects.forEach((name) => {
      try {
        config.deleteProject(name);
      } catch {
        // Ignore errors
      }
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

    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('proj1');
      config.deleteProject('proj2');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should show message when no projects exist', async () => {
    mockSelect.mockResolvedValueOnce('switch-project');

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('No projects configured')
    );
  });

  it('should list existing projects for selection', async () => {
    // Create test projects
    config.setProject('proj1', { path: '/tmp/proj1', ide: 'vscode', events: { cwd: true } });
    config.setProject('proj2', { path: '/tmp/proj2', ide: 'vscode', events: { cwd: true } });

    mockSelect
      .mockResolvedValueOnce('switch-project')
      .mockResolvedValueOnce('proj1');

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    // Should have called select with project choices
    const projectSelectCall = mockSelect.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { message: string }).message === 'Select a project to open:'
    );
    expect(projectSelectCall).toBeDefined();

    const choices = (projectSelectCall?.[0] as { choices: Array<{ value: string }> }).choices;
    expect(choices.map((c) => c.value)).toContain('proj1');
    expect(choices.map((c) => c.value)).toContain('proj2');
  });

  it('should not show branch configs in project list', async () => {
    // Create test project and branch
    config.setProject('proj1', { path: '/tmp/proj1', ide: 'vscode', events: { cwd: true } });
    config.setProject('proj1#feature', {
      path: '/tmp/proj1',
      ide: 'vscode',
      events: { cwd: true },
      branch: 'feature',
    });

    mockSelect
      .mockResolvedValueOnce('switch-project')
      .mockResolvedValueOnce('proj1');

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    const projectSelectCall = mockSelect.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { message: string }).message === 'Select a project to open:'
    );

    const choices = (projectSelectCall?.[0] as { choices: Array<{ value: string }> }).choices;
    expect(choices.map((c) => c.value)).not.toContain('proj1#feature');

    config.deleteProject('proj1#feature');
  });
});

describe('switch-branch flow', () => {
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

  beforeEach(() => {
    config = new Config();
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('testproj');
      config.deleteProject('testproj#feature');
      config.deleteProject('testproj#bugfix');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should show message when no branches exist', async () => {
    config.setProject('testproj', { path: '/tmp/testproj', ide: 'vscode', events: { cwd: true } });

    const projectEnv = new ProjectEnvironment({
      name: 'testproj',
      path: '/tmp/testproj',
      events: { cwd: true },
    });

    mockSelect.mockResolvedValueOnce('switch-branch');

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('No branch configurations found')
    );
  });

  it('should list existing branches for selection', async () => {
    config.setProject('testproj', { path: '/tmp/testproj', ide: 'vscode', events: { cwd: true } });
    config.setProject('testproj#feature', {
      path: '/tmp/testproj',
      ide: 'vscode',
      events: { cwd: true },
      branch: 'feature',
    });
    config.setProject('testproj#bugfix', {
      path: '/tmp/testproj',
      ide: 'vscode',
      events: { cwd: true },
      branch: 'bugfix',
    });

    const projectEnv = new ProjectEnvironment({
      name: 'testproj',
      path: '/tmp/testproj',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('switch-branch')
      .mockResolvedValueOnce('testproj#feature');

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    const branchSelectCall = mockSelect.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { message: string }).message === 'Select a branch configuration:'
    );
    expect(branchSelectCall).toBeDefined();

    const choices = (branchSelectCall?.[0] as { choices: Array<{ name: string; value: string }> })
      .choices;
    expect(choices.map((c) => c.name)).toContain('feature');
    expect(choices.map((c) => c.name)).toContain('bugfix');
  });
});

describe('manage-projects flow', () => {
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

  beforeEach(() => {
    config = new Config();
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('manageproj');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should show manage menu and return on back', async () => {
    mockSelect
      .mockResolvedValueOnce('manage-projects')
      .mockResolvedValueOnce('back');

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    const manageMenuCall = mockSelect.mock.calls.find(
      (call: unknown[]) => (call[0] as { message: string }).message === 'Manage projects:'
    );
    expect(manageMenuCall).toBeDefined();
  });

  it('should allow creating a project from manage menu', async () => {
    mockSelect
      .mockResolvedValueOnce('manage-projects')
      .mockResolvedValueOnce('create')
      .mockResolvedValueOnce('vscode') // IDE
      .mockResolvedValueOnce('back'); // Back to main

    mockInput
      .mockResolvedValueOnce('manageproj') // name
      .mockResolvedValueOnce('/tmp/manageproj'); // path

    mockCheckbox.mockResolvedValueOnce(['cwd']);
    mockConfirm.mockResolvedValueOnce(true); // Confirm save

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    const project = config.getProject('manageproj');
    expect(project).toBeDefined();
    expect(project?.ide).toBe('vscode');
  });

  it('should list projects from manage menu', async () => {
    config.setProject('manageproj', { path: '/tmp/manageproj', ide: 'vscode', events: { cwd: true } });

    mockSelect
      .mockResolvedValueOnce('manage-projects')
      .mockResolvedValueOnce('list')
      .mockResolvedValueOnce('back');

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    // Should have logged project info
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('manageproj'));
  });

  it('should delete project from manage menu', async () => {
    config.setProject('manageproj', { path: '/tmp/manageproj', ide: 'vscode', events: { cwd: true } });

    mockSelect
      .mockResolvedValueOnce('manage-projects')
      .mockResolvedValueOnce('delete')
      .mockResolvedValueOnce('manageproj') // Select project to delete
      .mockResolvedValueOnce('back');

    mockConfirm.mockResolvedValueOnce(true); // Confirm delete

    await runInteractive({
      config,
      log: mockLog,
      environment: new BaseEnvironment(),
    });

    const project = config.getProject('manageproj');
    expect(project).toBeUndefined();
  });
});

describe('manage-branches flow', () => {
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

  beforeEach(() => {
    config = new Config();
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
    mockConfirm.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('branchproj');
      config.deleteProject('branchproj#feature');
      config.deleteProject('branchproj#bugfix');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should show manage branches menu from project environment', async () => {
    config.setProject('branchproj', { path: '/tmp/branchproj', ide: 'vscode', events: { cwd: true } });

    const projectEnv = new ProjectEnvironment({
      name: 'branchproj',
      path: '/tmp/branchproj',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('manage-branches')
      .mockResolvedValueOnce('back');

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    const manageBranchesCall = mockSelect.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { message: string }).message === "Manage branches for 'branchproj':"
    );
    expect(manageBranchesCall).toBeDefined();
  });

  it('should create new branch config from manage branches', async () => {
    config.setProject('branchproj', { path: '/tmp/branchproj', ide: 'vscode', events: { cwd: true } });

    const projectEnv = new ProjectEnvironment({
      name: 'branchproj',
      path: '/tmp/branchproj',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('manage-branches')
      .mockResolvedValueOnce('create')
      .mockResolvedValueOnce('back');

    mockInput.mockResolvedValueOnce('feature'); // Branch name

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    const branch = config.getProject('branchproj#feature');
    expect(branch).toBeDefined();
  });

  it('should list branches from manage branches menu', async () => {
    config.setProject('branchproj', { path: '/tmp/branchproj', ide: 'vscode', events: { cwd: true } });
    config.setProject('branchproj#feature', {
      path: '/tmp/branchproj',
      ide: 'vscode',
      events: { cwd: true },
      branch: 'feature',
    });

    const projectEnv = new ProjectEnvironment({
      name: 'branchproj',
      path: '/tmp/branchproj',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('manage-branches')
      .mockResolvedValueOnce('list')
      .mockResolvedValueOnce('back');

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('feature'));
  });

  it('should delete branch config from manage branches', async () => {
    config.setProject('branchproj', { path: '/tmp/branchproj', ide: 'vscode', events: { cwd: true } });
    config.setProject('branchproj#feature', {
      path: '/tmp/branchproj',
      ide: 'vscode',
      events: { cwd: true },
      branch: 'feature',
    });

    const projectEnv = new ProjectEnvironment({
      name: 'branchproj',
      path: '/tmp/branchproj',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('manage-branches')
      .mockResolvedValueOnce('delete')
      .mockResolvedValueOnce('branchproj#feature') // Select branch to delete
      .mockResolvedValueOnce('back');

    mockConfirm.mockResolvedValueOnce(true); // Confirm delete

    await runInteractive({
      config,
      log: mockLog,
      environment: projectEnv,
    });

    const branch = config.getProject('branchproj#feature');
    expect(branch).toBeUndefined();
  });
});
