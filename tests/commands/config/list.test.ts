import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createListCommand } from '../../../src/commands/config/list.js';
import { Config } from '../../../src/lib/config.js';

describe('createListCommand', () => {
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
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should create a command named "list"', () => {
    const cmd = createListCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('list');
  });

  it('should have description', () => {
    const cmd = createListCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('List');
  });

  it('should be a Command instance', () => {
    const cmd = createListCommand({ config, log: mockLog });
    expect(cmd.constructor.name).toBe('Command');
  });

  describe('action', () => {
    it('should list configuration file path', async () => {
      const cmd = createListCommand({ config, log: mockLog });
      await cmd.parseAsync([], { from: 'user' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration file:'));
    });

    it('should list flattened config values', async () => {
      // Set some config values
      config.setProject('testproj', { path: '/test', events: { cwd: true } });

      const cmd = createListCommand({ config, log: mockLog });
      await cmd.parseAsync([], { from: 'user' });

      // Should have logged the project path
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('projects.testproj.path'));
    });

    it('should handle nested objects', async () => {
      config.set('project_defaults', { base: '/code', ide: 'vscode' });

      const cmd = createListCommand({ config, log: mockLog });
      await cmd.parseAsync([], { from: 'user' });

      // Should flatten nested values
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('project_defaults.base'));
    });
  });
});
