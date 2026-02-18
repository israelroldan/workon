import { describe, it, expect } from 'vitest';
import { Project } from '../../src/lib/project.js';

describe('Project', () => {
  describe('constructor', () => {
    it('should create a project with just a name', () => {
      const project = new Project('myproject');
      expect(project.name).toBe('myproject');
    });

    it('should use custom name from config over key name', () => {
      const project = new Project('key', { name: 'Custom Name', path: 'test', events: {} });
      expect(project.name).toBe('Custom Name');
    });

    it('should fall back to key name if no custom name provided', () => {
      const project = new Project('fallback', { path: 'test', events: {} });
      expect(project.name).toBe('fallback');
    });

    it('should default path to the project name', () => {
      const project = new Project('myproject', undefined, { base: '/tmp' });
      // Use toContain to handle macOS /tmp -> /private/tmp symlink
      expect(project.path.path).toContain('tmp/myproject');
    });
  });

  describe('path resolution', () => {
    it('should resolve path relative to base', () => {
      const project = new Project('test', { path: 'subdir', events: {} }, { base: '/tmp' });
      // Use toContain to handle macOS /tmp -> /private/tmp symlink
      expect(project.path.path).toContain('tmp/subdir');
    });

    it('should handle absolute paths without base', () => {
      const project = new Project('test', { path: '/absolute/path', events: {} });
      expect(project.path.path).toBe('/absolute/path');
    });

    it('should handle project created with only name (uses name as path)', () => {
      // When created with only a name, the constructor uses name as path
      // which gets resolved. This means path is always set.
      const project = new Project('test', undefined, { base: '/tmp' });
      expect(project.path.path).toContain('test');
    });

    it('should not mangle absolute path when base is also set', () => {
      // Regression: base.join(absolutePath) produced /base/absolute/path
      const project = new Project(
        'test',
        { path: '/opt/myproject', events: {} },
        { base: '/code' }
      );
      expect(project.path.path).toBe('/opt/myproject');
      expect(project.path.path).not.toContain('/code/opt');
    });

    it('should still join relative path with base', () => {
      const project = new Project(
        'test',
        { path: 'org/myapp', events: {} },
        { base: '/code' }
      );
      expect(project.path.path).toBe('/code/org/myapp');
    });

    it('should handle tilde base with relative path', () => {
      // base setter calls absolutify() which expands ~
      const project = new Project(
        'test',
        { path: 'myapp', events: {} },
        { base: '~/code' }
      );
      // Should resolve to home dir, not literal ~/code
      expect(project.path.path).not.toContain('~/');
      expect(project.path.path).toContain('myapp');
    });
  });

  describe('absolute path with base', () => {
    it('should not mangle absolute paths when base is set', () => {
      const project = new Project(
        'test',
        { path: '/opt/external/project', events: {} },
        { base: '/code' }
      );
      expect(project.path.path).toBe('/opt/external/project');
    });

    it('should not double-join when stored path is under a different absolute location', () => {
      const project = new Project(
        'test',
        { path: '/Users/someone/projects/app', events: {} },
        { base: '/Users/someone/code' }
      );
      // Before fix: would produce /Users/someone/code/Users/someone/projects/app
      expect(project.path.path).toBe('/Users/someone/projects/app');
    });

    it('should still join relative paths with base', () => {
      const project = new Project(
        'test',
        { path: 'myapp', events: {} },
        { base: '/code' }
      );
      expect(project.path.path).toContain('code/myapp');
    });
  });

  describe('base directory', () => {
    it('should set and get base directory', () => {
      const project = new Project('test');
      project.base = '/home/user/projects';
      expect(project.base?.path).toContain('/home/user/projects');
    });

    it('should apply base from defaults', () => {
      const project = new Project('test', { path: 'myapp', events: {} }, { base: '/code' });
      expect(project.path.path).toContain('myapp');
    });
  });

  describe('ide property', () => {
    it('should store ide from config', () => {
      const project = new Project('test', { path: 'test', ide: 'vscode', events: {} });
      expect(project.ide).toBe('vscode');
    });

    it('should allow setting ide', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      project.ide = 'idea';
      expect(project.ide).toBe('idea');
    });

    it('should be undefined if not set', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      expect(project.ide).toBeUndefined();
    });
  });

  describe('events property', () => {
    it('should store events from config', () => {
      const events = { cwd: true, ide: true, claude: { flags: ['--model', 'opus'] } };
      const project = new Project('test', { path: 'test', events }, { base: '/tmp' });
      expect(project.events).toEqual(events);
    });

    it('should default to empty events', () => {
      const project = new Project('test');
      expect(project.events).toEqual({});
    });

    it('should allow setting events', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      project.events = { cwd: true };
      expect(project.events).toEqual({ cwd: true });
    });
  });

  describe('branch property', () => {
    it('should store branch from config', () => {
      const project = new Project(
        'test',
        { path: 'test', branch: 'feature-x', events: {} },
        { base: '/tmp' }
      );
      expect(project.branch).toBe('feature-x');
    });

    it('should allow setting branch', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      project.branch = 'develop';
      expect(project.branch).toBe('develop');
    });

    it('should be undefined if not set', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      expect(project.branch).toBeUndefined();
    });
  });

  describe('homepage property', () => {
    it('should store homepage from config', () => {
      const project = new Project(
        'test',
        { path: 'test', homepage: 'https://example.com', events: {} },
        { base: '/tmp' }
      );
      expect(project.homepage).toBe('https://example.com');
    });

    it('should allow setting homepage', () => {
      const project = new Project('test', { path: 'test', events: {} }, { base: '/tmp' });
      project.homepage = 'https://myapp.dev';
      expect(project.homepage).toBe('https://myapp.dev');
    });
  });

  describe('$isProject marker', () => {
    it('should have static $isProject marker', () => {
      expect(Project.$isProject).toBe(true);
    });

    it('should have instance $isProject marker', () => {
      const project = new Project('test');
      expect(project.$isProject).toBe(true);
    });
  });

  describe('deep merge of defaults', () => {
    it('should merge defaults with config', () => {
      const defaults = { base: '/code', ide: 'vscode' as const };
      const project = new Project('test', { path: 'myapp', events: {} }, defaults);
      expect(project.ide).toBe('vscode');
      expect(project.path.path).toContain('myapp');
    });

    it('should allow config to override defaults', () => {
      const defaults = { base: '/code', ide: 'vscode' as const };
      const project = new Project('test', { path: 'myapp', ide: 'idea', events: {} }, defaults);
      expect(project.ide).toBe('idea');
    });
  });
});
