import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/lib/config.js';
import { EventRegistry } from '../../src/events/registry.js';

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const { mockSelect, mockInput, mockConfirm, mockCheckbox } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
  mockConfirm: vi.fn(),
  mockCheckbox: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  select: mockSelect,
  input: mockInput,
  confirm: mockConfirm,
  checkbox: mockCheckbox,
}));

// Import after mocking
import { createManageCommand } from '../../src/commands/manage.js';

describe('createManageCommand', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };

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

    // Reset all mocks
    mockSelect.mockReset();
    mockInput.mockReset();
    mockConfirm.mockReset();
    mockCheckbox.mockReset();
  });

  afterEach(() => {
    // Clean up test projects
    try {
      config.deleteProject('testproj');
      config.deleteProject('newproj');
    } catch {
      // Ignore
    }
  });

  it('should create a command named "manage"', () => {
    const cmd = createManageCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('manage');
  });

  it('should have description', () => {
    const cmd = createManageCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('Interactive');
  });

  it('should have debug option', () => {
    const cmd = createManageCommand({ config, log: mockLog });
    const debugOpt = cmd.options.find((o) => o.long === '--debug');
    expect(debugOpt).toBeDefined();
  });
});

describe('manage menu flows', () => {
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

    // Reset mocks
    mockSelect.mockReset();
    mockInput.mockReset();
    mockConfirm.mockReset();
    mockCheckbox.mockReset();

    // Initialize event registry
    EventRegistry.clear();
    await EventRegistry.initialize();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    try {
      config.deleteProject('testproj');
      config.deleteProject('newproj');
    } catch {
      // Ignore
    }
  });

  it('should show create option when no projects exist', async () => {
    mockSelect.mockResolvedValueOnce('exit');

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Should have been called with limited options (no edit/delete/list)
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'create' }),
          expect.objectContaining({ value: 'exit' }),
        ]),
      })
    );
  });

  it('should show all options when projects exist', async () => {
    config.setProject('existing', { path: '/tmp/existing', events: {} });

    mockSelect.mockResolvedValueOnce('exit');

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Should have all options
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'create' }),
          expect.objectContaining({ value: 'edit' }),
          expect.objectContaining({ value: 'delete' }),
          expect.objectContaining({ value: 'list' }),
        ]),
      })
    );

    config.deleteProject('existing');
  });

  it('should list projects when list is selected', async () => {
    config.setProject('proj1', {
      path: '/tmp/proj1',
      ide: 'vscode',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('list')
      .mockResolvedValueOnce('exit');

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Should have printed project info
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('proj1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('vscode'));

    config.deleteProject('proj1');
  });

  it('should delete project when confirmed', async () => {
    config.setProject('todelete', { path: '/tmp/todelete', events: {} });

    mockSelect
      .mockResolvedValueOnce('delete')
      .mockResolvedValueOnce('todelete')
      .mockResolvedValueOnce('exit');

    mockConfirm.mockResolvedValueOnce(true);

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Project should be deleted
    expect(config.getProject('todelete')).toBeUndefined();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('deleted'));
  });

  it('should not delete project when cancelled', async () => {
    config.setProject('tokeep', { path: '/tmp/tokeep', events: {} });

    mockSelect
      .mockResolvedValueOnce('delete')
      .mockResolvedValueOnce('tokeep')
      .mockResolvedValueOnce('exit');

    mockConfirm.mockResolvedValueOnce(false);

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Project should still exist
    expect(config.getProject('tokeep')).toBeDefined();
    expect(mockLog.info).toHaveBeenCalledWith('Delete cancelled.');

    config.deleteProject('tokeep');
  });

  it('should create new project with all inputs', async () => {
    mockSelect
      .mockResolvedValueOnce('create')
      .mockResolvedValueOnce('vscode') // IDE
      .mockResolvedValueOnce('exit');

    mockInput
      .mockResolvedValueOnce('newproj') // Name
      .mockResolvedValueOnce('/tmp') // Path (use /tmp which exists)
      .mockResolvedValueOnce(''); // Homepage

    mockCheckbox.mockResolvedValueOnce(['cwd', 'ide']);
    mockConfirm.mockResolvedValueOnce(true);

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Project should be created
    const project = config.getProject('newproj');
    expect(project).toBeDefined();
    expect(project?.ide).toBe('vscode');

    config.deleteProject('newproj');
  });

  it('should edit project path and IDE', async () => {
    config.setProject('toedit', {
      path: '/tmp/old',
      ide: 'atom',
      events: { cwd: true },
    });

    mockSelect
      .mockResolvedValueOnce('edit')
      .mockResolvedValueOnce('toedit')
      .mockResolvedValueOnce('vscode') // New IDE
      .mockResolvedValueOnce('exit');

    mockInput
      .mockResolvedValueOnce('/tmp/new') // New path
      .mockResolvedValueOnce('https://example.com'); // Homepage

    mockConfirm
      .mockResolvedValueOnce(true) // Keep events
      .mockResolvedValueOnce(true); // Save

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    const project = config.getProject('toedit');
    expect(project?.ide).toBe('vscode');
    expect(project?.homepage).toBe('https://example.com');

    config.deleteProject('toedit');
  });
});

describe('IDE_CHOICES constant', () => {
  it('should include common IDEs in selection', async () => {
    const config = new Config();
    const mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };

    mockSelect
      .mockResolvedValueOnce('create')
      .mockResolvedValueOnce('vscode')
      .mockResolvedValueOnce('exit');

    mockInput
      .mockResolvedValueOnce('idetest')
      .mockResolvedValueOnce('/tmp')
      .mockResolvedValueOnce('');

    mockCheckbox.mockResolvedValueOnce([]);
    mockConfirm.mockResolvedValueOnce(false); // Cancel

    EventRegistry.clear();
    await EventRegistry.initialize();

    const cmd = createManageCommand({ config, log: mockLog });
    await cmd.parseAsync([], { from: 'user' });

    // Find the IDE selection call
    const ideCall = mockSelect.mock.calls.find(
      (call) => call[0].message === 'Select IDE:'
    );

    expect(ideCall).toBeDefined();
    const choices = ideCall?.[0].choices as Array<{ value: string }>;
    const values = choices.map((c) => c.value);

    expect(values).toContain('vscode');
    expect(values).toContain('idea');
    expect(values).toContain('vim');
    expect(values).toContain('emacs');
  });
});
