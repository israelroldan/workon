import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCli } from '../../src/commands/index.js';
import { Config } from '../../src/lib/config.js';

// Mock inquirer prompts to avoid interactive prompts in tests
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue('exit'),
  input: vi.fn().mockResolvedValue('test'),
  checkbox: vi.fn().mockResolvedValue([]),
  confirm: vi.fn().mockResolvedValue(false),
}));

// Mock TmuxManager
vi.mock('../../src/lib/tmux.js', () => ({
  TmuxManager: vi.fn().mockImplementation(() => ({
    isTmuxAvailable: vi.fn().mockResolvedValue(false),
    getSessionName: vi.fn((name: string) => `workon-${name}`),
    buildShellCommands: vi.fn(() => ['# mock tmux commands']),
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFile: vi.fn((file, args, opts, callback) => {
    const cb = [args, opts, callback].find((c) => typeof c === 'function');
    if (cb) cb(null, '', '');
    return { stdout: '', stderr: '' };
  }),
  exec: vi.fn((cmd, opts, callback) => {
    // Handle both 2-arg and 3-arg versions
    const cb = typeof opts === 'function' ? opts : callback;
    if (cb) cb(null, '', '');
    return { stdout: '', stderr: '' };
  }),
}));

describe('createCli', () => {
  let config: Config;

  beforeEach(() => {
    config = new Config();
  });

  afterEach(() => {
    try {
      config.deleteProject('testproject');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create a CLI program named "workon"', () => {
    const program = createCli();
    expect(program.name()).toBe('workon');
  });

  it('should have a project argument', () => {
    const program = createCli();
    expect(program.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(program.registeredArguments[0].name()).toBe('project');
  });

  it('should have debug option', () => {
    const program = createCli();
    const debugOpt = program.options.find((o) => o.long === '--debug');
    expect(debugOpt).toBeDefined();
  });

  it('should have shell option', () => {
    const program = createCli();
    const shellOpt = program.options.find((o) => o.long === '--shell');
    expect(shellOpt).toBeDefined();
  });

  it('should have init option', () => {
    const program = createCli();
    const initOpt = program.options.find((o) => o.long === '--init');
    expect(initOpt).toBeDefined();
  });

  it('should have completion option', () => {
    const program = createCli();
    const completionOpt = program.options.find((o) => o.long === '--completion');
    expect(completionOpt).toBeDefined();
  });

  describe('subcommands', () => {
    it('should have "open" command', () => {
      const program = createCli();
      const openCmd = program.commands.find((c) => c.name() === 'open');
      expect(openCmd).toBeDefined();
    });

    it('should have "add" command', () => {
      const program = createCli();
      const addCmd = program.commands.find((c) => c.name() === 'add');
      expect(addCmd).toBeDefined();
    });

    it('should have "config" command', () => {
      const program = createCli();
      const configCmd = program.commands.find((c) => c.name() === 'config');
      expect(configCmd).toBeDefined();
    });

    it('should have "manage" command', () => {
      const program = createCli();
      const manageCmd = program.commands.find((c) => c.name() === 'manage');
      expect(manageCmd).toBeDefined();
    });

    it('should have "worktrees" command', () => {
      const program = createCli();
      const worktreesCmd = program.commands.find((c) => c.name() === 'worktrees');
      expect(worktreesCmd).toBeDefined();
    });
  });

  describe('project argument handling', () => {
    it('should accept project name as argument', () => {
      const program = createCli();
      // The argument should be optional and named 'project'
      const projectArg = program.registeredArguments[0];
      expect(projectArg.name()).toBe('project');
      expect(projectArg.required).toBe(false);
    });

    it('should support project:command syntax in argument description', () => {
      const program = createCli();
      const projectArg = program.registeredArguments[0];
      expect(projectArg.description).toContain('project:command');
    });
  });
});
