import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BaseEnvironment,
  ProjectEnvironment,
  EnvironmentRecognizer,
} from '../../src/lib/environment.js';
import { Config } from '../../src/lib/config.js';

// Mock simple-git
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    branchLocal: vi.fn().mockResolvedValue({ current: 'main' }),
  })),
}));

describe('BaseEnvironment', () => {
  it('should have $isProjectEnvironment set to false', () => {
    const env = new BaseEnvironment();
    expect(env.$isProjectEnvironment).toBe(false);
  });
});

describe('ProjectEnvironment', () => {
  it('should have $isProjectEnvironment set to true', () => {
    const env = new ProjectEnvironment({
      name: 'test',
      path: '/test/path',
      events: {},
    });
    expect(env.$isProjectEnvironment).toBe(true);
  });

  it('should create a project from config', () => {
    const env = new ProjectEnvironment({
      name: 'myproject',
      path: '/path/to/project',
      ide: 'vscode',
      events: { cwd: true },
    });
    expect(env.project.name).toBe('myproject');
  });

  describe('load', () => {
    it('should load project environment with defaults', () => {
      const env = ProjectEnvironment.load(
        { name: 'test', path: 'myapp', events: { cwd: true } },
        { base: '/code' }
      );
      expect(env.$isProjectEnvironment).toBe(true);
      expect(env.project.name).toBe('test');
    });
  });
});

describe('EnvironmentRecognizer', () => {
  let mockConfig: Config;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset the static state by accessing private members
    // @ts-expect-error - accessing private static
    EnvironmentRecognizer.configured = false;
    // @ts-expect-error - accessing private static
    EnvironmentRecognizer.projects = [];

    mockConfig = new Config();
    // Clear all projects to ensure test isolation
    const projects = mockConfig.getProjects();
    Object.keys(projects).forEach((name) => mockConfig.deleteProject(name));

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLogLevel: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up any projects created during tests
    const projects = mockConfig.getProjects();
    Object.keys(projects).forEach((name) => mockConfig.deleteProject(name));
  });

  describe('configure', () => {
    it('should configure the recognizer', () => {
      EnvironmentRecognizer.configure(mockConfig, mockLogger);
      // Should not throw
    });

    it('should be idempotent', () => {
      EnvironmentRecognizer.configure(mockConfig, mockLogger);
      EnvironmentRecognizer.configure(mockConfig, mockLogger);
      // Should not throw
    });
  });

  describe('recognize', () => {
    it('should return BaseEnvironment when no projects configured', async () => {
      EnvironmentRecognizer.configure(mockConfig, mockLogger);

      // Use an existing directory to avoid canonicalize returning null
      const result = await EnvironmentRecognizer.recognize('/tmp');
      expect(result).toBeInstanceOf(BaseEnvironment);
    });

    it('should return BaseEnvironment for non-matching directory', async () => {
      // Set up a project in config
      mockConfig.set('project_defaults', { base: '/code' });
      mockConfig.setProject('myproject', { path: 'myproject', events: { cwd: true } });

      EnvironmentRecognizer.configure(mockConfig, mockLogger);

      // Use an existing directory that doesn't match the project
      const result = await EnvironmentRecognizer.recognize('/tmp');
      expect(result).toBeInstanceOf(BaseEnvironment);
    });

    it('should auto-configure if not configured', async () => {
      // Reset configured state
      // @ts-expect-error - accessing private static
      EnvironmentRecognizer.configured = false;

      // Use an existing directory
      const result = await EnvironmentRecognizer.recognize('/tmp');
      expect(result).toBeInstanceOf(BaseEnvironment);
    });
  });
});
