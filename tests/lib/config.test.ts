import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/lib/config.js';

describe('Config', () => {
  let config: Config;

  beforeEach(() => {
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
});
