import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/lib/config.js';
import { BaseEnvironment, ProjectEnvironment } from '../../src/lib/environment.js';

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const { mockSelect, mockInput, mockCheckbox } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
  mockCheckbox: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  select: mockSelect,
  input: mockInput,
  checkbox: mockCheckbox,
}));

// Import after mocking
import { runInteractive } from '../../src/commands/interactive.js';

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

    // Reset all mocks
    mockSelect.mockReset();
    mockInput.mockReset();
    mockCheckbox.mockReset();
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
