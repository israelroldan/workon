import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/lib/config.js';

describe('Config', () => {
  let config: Config;

  beforeEach(() => {
    Config.resetInstance();
    config = new Config();
  });

  afterEach(() => {
    // Clean up test data
    config.delete('test_key');
    config.delete('test_project');
  });

  describe('get/set', () => {
    it('should set and get a value', () => {
      config.set('test_key', 'test_value');
      expect(config.get('test_key')).toBe('test_value');
    });

    it('should return default value if key does not exist', () => {
      expect(config.get('nonexistent', 'default')).toBe('default');
    });

    it('should handle transient properties', () => {
      config.set('pkg', { version: '1.0.0' });
      expect(config.get('pkg')).toEqual({ version: '1.0.0' });
    });

    it('should throw when setting undefined value', () => {
      expect(() => config.set('test_key', undefined)).toThrow(
        "Cannot set 'test_key' to undefined"
      );
    });
  });

  describe('has', () => {
    it('should return true if key exists', () => {
      config.set('test_key', 'value');
      expect(config.has('test_key')).toBe(true);
    });

    it('should return false if key does not exist', () => {
      expect(config.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a key', () => {
      config.set('test_key', 'value');
      config.delete('test_key');
      expect(config.has('test_key')).toBe(false);
    });
  });

  describe('projects', () => {
    it('should get and set projects', () => {
      const project = {
        path: 'test/path',
        ide: 'vscode' as const,
        events: { cwd: true },
      };

      config.setProject('test_project', project);
      expect(config.getProject('test_project')).toEqual(project);
    });

    it('should delete a project', () => {
      config.setProject('test_project', { path: 'test', events: {} });
      config.deleteProject('test_project');
      expect(config.getProject('test_project')).toBeUndefined();
    });
  });

  describe('safe async methods', () => {
    it('should set project safely with locking', async () => {
      const project = {
        path: 'test/path',
        ide: 'vscode' as const,
        events: { cwd: true },
      };

      await config.setProjectSafe('test_project', project);
      expect(config.getProject('test_project')).toEqual(project);
    });

    it('should delete project safely with locking', async () => {
      config.setProject('test_project', { path: 'test', events: {} });
      await config.deleteProjectSafe('test_project');
      expect(config.getProject('test_project')).toBeUndefined();
    });

    it('should handle concurrent setProjectSafe calls', async () => {
      const project1 = { path: 'path1', ide: 'vscode' as const, events: { cwd: true } };
      const project2 = { path: 'path2', ide: 'idea' as const, events: { ide: true } };

      // Run both operations concurrently
      await Promise.all([
        config.setProjectSafe('project1', project1),
        config.setProjectSafe('project2', project2),
      ]);

      // Both should be saved
      expect(config.getProject('project1')).toEqual(project1);
      expect(config.getProject('project2')).toEqual(project2);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance with getInstance', () => {
      const instance1 = Config.getInstance();
      const instance2 = Config.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetInstance', () => {
      const instance1 = Config.getInstance();
      Config.resetInstance();
      const instance2 = Config.getInstance();
      // In test mode, these will be different instances
      expect(instance1).not.toBe(instance2);
    });
  });
});
