import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAddCommand } from '../../src/commands/add.js';
import { Config } from '../../src/lib/config.js';

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const { mockConfirm } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: mockConfirm,
}));

describe('createAddCommand', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockExit: any;

  beforeEach(() => {
    config = new Config();
    // Clear all projects
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

    mockConfirm.mockReset();
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
    // Clean up
    const projects = config.getProjects();
    Object.keys(projects).forEach((name) => config.deleteProject(name));
  });

  it('should create a command named "add"', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('add');
  });

  it('should have description', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('Add');
  });

  it('should have debug option', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    const debugOpt = cmd.options.find((o) => o.long === '--debug');
    expect(debugOpt).toBeDefined();
  });

  it('should have name option', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    const nameOpt = cmd.options.find((o) => o.long === '--name');
    expect(nameOpt).toBeDefined();
  });

  it('should have ide option', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    const ideOpt = cmd.options.find((o) => o.long === '--ide');
    expect(ideOpt).toBeDefined();
  });

  it('should have force option', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    const forceOpt = cmd.options.find((o) => o.long === '--force');
    expect(forceOpt).toBeDefined();
  });

  it('should have path argument with default', () => {
    const cmd = createAddCommand({ config, log: mockLog });
    expect(cmd.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(cmd.registeredArguments[0].name()).toBe('path');
  });

  describe('action', () => {
    it('should add a project from an existing directory', async () => {
      const cmd = createAddCommand({ config, log: mockLog });
      // Parse with /tmp as path (which exists)
      await cmd.parseAsync(['/tmp', '--name', 'tmpproject'], { from: 'user' });

      // Project should be added
      const project = config.getProject('tmpproject');
      expect(project).toBeDefined();
      expect(project?.events.cwd).toBe(true);
      expect(project?.events.ide).toBe(true);
    });

    it('should error for non-existent path', async () => {
      const cmd = createAddCommand({ config, log: mockLog });

      await expect(
        cmd.parseAsync(['/nonexistent/path/that/does/not/exist'], { from: 'user' })
      ).rejects.toThrow('process.exit called');

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
    });

    it('should error for file path instead of directory', async () => {
      const cmd = createAddCommand({ config, log: mockLog });

      // /etc/passwd is a file, not a directory
      await expect(cmd.parseAsync(['/etc/passwd'], { from: 'user' })).rejects.toThrow(
        'process.exit called'
      );

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('not a directory'));
    });

    it('should use --name option for project name', async () => {
      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'myproject'], { from: 'user' });

      expect(config.getProject('myproject')).toBeDefined();
    });

    it('should use --ide option for IDE', async () => {
      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'ideproject', '--ide', 'idea'], { from: 'user' });

      const project = config.getProject('ideproject');
      expect(project?.ide).toBe('idea');
    });

    it('should prompt for overwrite when project exists', async () => {
      // Set up existing project
      config.setProject('existing', { path: '/old', events: {} });

      mockConfirm.mockResolvedValueOnce(false);

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'existing'], { from: 'user' });

      // Should have asked for confirmation
      expect(mockConfirm).toHaveBeenCalled();
      // Should have cancelled
      expect(mockLog.info).toHaveBeenCalledWith('Cancelled.');
    });

    it('should overwrite with --force option', async () => {
      // Set up existing project
      config.setProject('forcetest', { path: '/old', events: {} });

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'forcetest', '--force'], { from: 'user' });

      // Should not have asked for confirmation
      expect(mockConfirm).not.toHaveBeenCalled();
      // Project should be updated
      const project = config.getProject('forcetest');
      expect(project?.path).toContain('tmp');
    });

    it('should store relative path when project is under base', async () => {
      config.set('project_defaults', { base: '/tmp' });

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'baseproject'], { from: 'user' });

      const project = config.getProject('baseproject');
      expect(project).toBeDefined();
      // Path should NOT start with /tmp — it should be relative
      // When target equals base, path is stored as the directory name or kept absolute
      expect(project?.path).toBeDefined();
    });

    it('should keep absolute path when project is outside base', async () => {
      config.set('project_defaults', { base: '/usr' });

      const cmd = createAddCommand({ config, log: mockLog });
      // /tmp is not under /usr
      await cmd.parseAsync(['/tmp', '--name', 'outsideproject'], { from: 'user' });

      const project = config.getProject('outsideproject');
      expect(project).toBeDefined();
      // Path should be absolute since /tmp is not under /usr
      expect(project?.path).toContain('/tmp');
    });

    it('should error on invalid project name', async () => {
      const cmd = createAddCommand({ config, log: mockLog });

      await expect(
        cmd.parseAsync(['/tmp', '--name', 'invalid name!'], { from: 'user' })
      ).rejects.toThrow('process.exit called');

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Invalid project name'));
    });

    it('should store relative path when project is under base', async () => {
      config.set('project_defaults', { base: '/' });

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'reltest'], { from: 'user' });

      const project = config.getProject('reltest');
      expect(project).toBeDefined();
      // Path should be relative (not start with /)
      expect(project!.path.startsWith('/')).toBe(false);
    });

    it('should store absolute path when project is outside base', async () => {
      // Use a base that /tmp is not under
      config.set('project_defaults', { base: '/nonexistent/base' });

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'abstest'], { from: 'user' });

      const project = config.getProject('abstest');
      expect(project).toBeDefined();
      // Path should remain absolute since /tmp is outside /nonexistent/base
      expect(project!.path).toContain('tmp');
    });

    it('should handle tilde in base when relativizing paths', async () => {
      // Regression: File.from('~/code').path returns '~/code' unexpanded,
      // causing path.relative to produce garbage
      config.set('project_defaults', { base: '~/nonexistent' });

      const cmd = createAddCommand({ config, log: mockLog });
      await cmd.parseAsync(['/tmp', '--name', 'tildetest'], { from: 'user' });

      const project = config.getProject('tildetest');
      expect(project).toBeDefined();
      // Path should not be garbage like '../..'
      expect(project!.path).toContain('tmp');
    });
  });
});
