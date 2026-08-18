import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  symlinkSync,
  unlinkSync,
} from 'fs';
import { realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  WorktreeManager,
  isPathInside,
  deriveProjectIdentifier,
  getWorktreesRoot,
  normalizePath,
} from '../../src/lib/worktree.js';

/**
 * These are integration tests against real git repositories: the bugs they
 * cover (branch resolution, merge side effects, stale worktrees, hook
 * execution) only show up when git is actually involved.
 */

const originalHome = process.env.HOME;
let sandbox: string;

/** Point HOME at a sandbox so managed worktrees never touch the real ~/.workon */
beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'workon-wt-')));
  process.env.HOME = sandbox;
});

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

async function makeRepo(name = 'proj'): Promise<{ dir: string; git: SimpleGit }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `workon-${name}-`)));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  await git.add('.');
  await git.commit('init');
  await git.raw(['branch', '-M', 'main']);
  return { dir, git };
}

async function commitFile(git: SimpleGit, dir: string, file: string, body: string) {
  writeFileSync(join(dir, file), body);
  await git.add(file);
  await git.commit(`add ${file}`);
}

describe('isPathInside', () => {
  it('accepts a real child', () => {
    expect(isPathInside('/a/b/c', '/a/b')).toBe(true);
  });

  it('rejects a sibling that merely shares a prefix', () => {
    // The bug: startsWith() treated app-1234 worktrees as living under app-12
    expect(isPathInside('/root/app-1234abcd-old/feat', '/root/app-1234abcd')).toBe(false);
  });

  it('rejects the directory itself', () => {
    expect(isPathInside('/a/b', '/a/b')).toBe(false);
  });

  it('rejects an unrelated path', () => {
    expect(isPathInside('/x/y', '/a/b')).toBe(false);
  });
});

describe('deriveProjectIdentifier', () => {
  it('is stable for the same path', () => {
    expect(deriveProjectIdentifier('/code/app')).toBe(deriveProjectIdentifier('/code/app'));
  });

  it('differs for same-named projects in different locations', () => {
    expect(deriveProjectIdentifier('/code/a/app')).not.toBe(deriveProjectIdentifier('/code/b/app'));
  });

  it('resolves symlinked paths to the same identifier', () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'workon-sym-')));
    const link = join(sandbox, 'linked-project');
    try {
      symlinkSync(real, link);
      expect(deriveProjectIdentifier(link)).toBe(deriveProjectIdentifier(real));
    } finally {
      unlinkSync(link);
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe('normalizePath', () => {
  it('returns the input when the path does not exist', () => {
    expect(normalizePath('/definitely/not/here')).toBe('/definitely/not/here');
  });
});

describe('WorktreeManager', () => {
  let dir: string;
  let git: SimpleGit;
  let manager: WorktreeManager;
  const cleanup: string[] = [];

  beforeEach(async () => {
    ({ dir, git } = await makeRepo());
    cleanup.push(dir);
    manager = new WorktreeManager(dir);
  });

  afterEach(() => {
    const worktreesDir = manager.getWorktreesDir();
    rmSync(worktreesDir, { recursive: true, force: true });
    while (cleanup.length) {
      rmSync(cleanup.pop() as string, { recursive: true, force: true });
    }
  });

  describe('getOriginalBranch', () => {
    it('returns the branch the worktree was created for', async () => {
      await manager.add({ branch: 'feature/login' });
      expect(await manager.getOriginalBranch('feature-login')).toEqual({
        branch: 'feature/login',
        exists: true,
      });
    });

    it('still returns it after the worktree checks out another branch', async () => {
      // Regression: the old implementation read the *current* checkout from
      // `git worktree list`, so `recycle` never switched back.
      const wt = await manager.add({ branch: 'feature/login' });
      await simpleGit(wt.path).checkoutLocalBranch('review-pr-42');

      expect(await manager.getOriginalBranch('feature-login')).toEqual({
        branch: 'feature/login',
        exists: true,
      });
    });

    it('reports the branch as missing once it has been deleted', async () => {
      // The branch is typically cleaned up after it merges; the worktree still
      // belongs to it, so callers can put it back rather than falling through
      // to whatever branch the last task left checked out.
      const wt = await manager.add({ branch: 'worktree-a' });
      await simpleGit(wt.path).checkoutLocalBranch('branch-b');
      await manager.getBranches();
      await simpleGit(dir).raw(['branch', '-D', 'worktree-a']);

      expect(await manager.getOriginalBranch('worktree-a')).toEqual({
        branch: 'worktree-a',
        exists: false,
      });
    });

    it('falls back to the current branch for an external worktree', async () => {
      const external = join(realpathSync(tmpdir()), `workon-ext-${Date.now()}`);
      cleanup.push(external);
      await git.raw(['worktree', 'add', '-b', 'ext-branch', external]);

      expect(await manager.getOriginalBranch('ext-branch')).toEqual({
        branch: 'ext-branch',
        exists: true,
      });
    });

    it('recovers a slash-bearing branch name from the remote once deleted', async () => {
      // The directory name is a flattened form ('feature/login' -> 'feature-login'),
      // so recreating from it alone would land on the wrong branch name.
      const origin = join(realpathSync(tmpdir()), `workon-origin-${Date.now()}.git`);
      cleanup.push(origin);
      await git.raw(['init', '--bare', origin]);
      await git.addRemote('origin', origin);

      const wt = await manager.add({ branch: 'feature/login' });
      await simpleGit(wt.path).push(['-u', 'origin', 'feature/login']);
      await simpleGit(wt.path).checkoutLocalBranch('branch-b');
      await git.raw(['branch', '-D', 'feature/login']);

      expect(await manager.getOriginalBranch('feature-login')).toEqual({
        branch: 'feature/login',
        exists: false,
      });
    });

    it('is not confused by a branch that collides with the flattened name', async () => {
      // 'feature/login' and 'feature-login' both map to directory 'feature-login',
      // so the directory name alone cannot tell them apart. What `add` recorded can.
      const wt = await manager.add({ branch: 'feature/login' });
      await git.raw(['branch', 'feature-login']);
      await simpleGit(wt.path).checkoutLocalBranch('branch-b');

      expect(await manager.getOriginalBranch('feature-login')).toEqual({
        branch: 'feature/login',
        exists: true,
      });
    });

    it('falls back to the directory name for worktrees created before recording', async () => {
      const wt = await manager.add({ branch: 'legacy-wt' });
      // Simulate a worktree created by an earlier version: no recorded branch
      await git.raw(['config', '--local', '--unset', 'workon.worktree.legacy-wt.branch']);
      await simpleGit(wt.path).checkoutLocalBranch('branch-b');

      expect(await manager.getOriginalBranch('legacy-wt')).toEqual({
        branch: 'legacy-wt',
        exists: true,
      });
    });

    it('returns null for an unknown worktree', async () => {
      expect(await manager.getOriginalBranch('nope')).toBeNull();
    });
  });

  describe('add', () => {
    it('creates a worktree under the managed directory', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      expect(isPathInside(wt.path, manager.getWorktreesDir())).toBe(true);
      expect(manager.isManaged(wt)).toBe(true);
      expect(existsSync(wt.path)).toBe(true);
    });

    it('refuses to add a duplicate without force', async () => {
      await manager.add({ branch: 'feat-a' });
      await expect(manager.add({ branch: 'feat-a' })).rejects.toThrow(/already exists/);
    });

    it('recovers when the worktree directory was deleted behind our back', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      rmSync(wt.path, { recursive: true, force: true });

      // Previously this failed with "already exists" until the user pruned by hand
      const recreated = await manager.add({ branch: 'feat-a' });
      expect(existsSync(recreated.path)).toBe(true);
    });

    it('refuses to force-replace a worktree holding uncommitted changes', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      writeFileSync(join(wt.path, 'work-in-progress.txt'), 'do not lose me');

      await expect(manager.add({ branch: 'feat-a', force: true })).rejects.toThrow(
        /uncommitted changes/
      );
      expect(existsSync(join(wt.path, 'work-in-progress.txt'))).toBe(true);
    });

    it('force-replaces a clean worktree', async () => {
      await manager.add({ branch: 'feat-a' });
      const replaced = await manager.add({ branch: 'feat-a', force: true });
      expect(existsSync(replaced.path)).toBe(true);
    });
  });

  describe('merge', () => {
    it('puts the main worktree back on the branch it started on', async () => {
      await git.checkoutLocalBranch('scratch');
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'feature.txt', 'work');

      const result = await manager.merge('feat-a', { targetBranch: 'main' });

      expect(result.previousBranch).toBe('scratch');
      expect(result.restored).toBe(true);
      expect(await manager.getCurrentBranch()).toBe('scratch');
    });

    it('actually merges the commits into the target branch', async () => {
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'feature.txt', 'work');

      await manager.merge('feat-a', { targetBranch: 'main' });

      const log = await git.log(['main']);
      expect(log.all.some((c) => c.message.includes('add feature.txt'))).toBe(true);
    });

    it('is not blocked by untracked files in the main worktree', async () => {
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'feature.txt', 'work');
      writeFileSync(join(dir, 'scratch-notes.txt'), 'untracked, harmless');

      await expect(manager.merge('feat-a', { targetBranch: 'main' })).resolves.toBeTruthy();
      expect(existsSync(join(dir, 'scratch-notes.txt'))).toBe(true);
    });

    it('refuses when the main worktree is dirty', async () => {
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'feature.txt', 'work');
      writeFileSync(join(dir, 'README.md'), 'edited but not committed\n');

      await expect(manager.merge('feat-a', { targetBranch: 'main' })).rejects.toThrow(
        /uncommitted changes/
      );
    });

    it('refuses when the target branch is checked out in another worktree', async () => {
      await manager.add({ branch: 'shared', baseBranch: 'main' });
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'feature.txt', 'work');

      await expect(manager.merge('feat-a', { targetBranch: 'shared' })).rejects.toThrow(
        /checked out in worktree/
      );
    });

    it('reports a no-op squash instead of failing on an empty commit', async () => {
      await manager.add({ branch: 'feat-a', baseBranch: 'main' });

      await expect(manager.merge('feat-a', { targetBranch: 'main', squash: true })).rejects.toThrow(
        /already contained/
      );
      // Repo is left usable, on the branch it started on
      expect(await manager.getCurrentBranch()).toBe('main');
    });

    it('leaves the repo on its original branch when the merge conflicts', async () => {
      const wt = await manager.add({ branch: 'feat-a', baseBranch: 'main' });
      await commitFile(simpleGit(wt.path), wt.path, 'README.md', 'from the worktree\n');
      await commitFile(git, dir, 'README.md', 'from main\n');
      await git.checkoutLocalBranch('scratch');

      // Regression: simple-git reports a conflicted merge as a success because
      // git writes CONFLICT to stdout, so this used to "succeed" and the caller
      // went on to delete the worktree and its branch.
      await expect(manager.merge('feat-a', { targetBranch: 'main' })).rejects.toThrow(/conflict/i);

      expect(await manager.getCurrentBranch()).toBe('scratch');
      const status = await git.status();
      expect(status.conflicted).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('removes a managed worktree', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      await manager.remove('feat-a');
      expect(existsSync(wt.path)).toBe(false);
      expect(await manager.get('feat-a')).toBeNull();
    });

    it('refuses to remove a worktree with uncommitted changes', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      writeFileSync(join(wt.path, 'wip.txt'), 'unsaved');
      await expect(manager.remove('feat-a')).rejects.toThrow(/uncommitted changes/);
    });

    it('cleans up a worktree whose directory is already gone', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      rmSync(wt.path, { recursive: true, force: true });
      await manager.remove('feat-a');
      expect(await manager.get('feat-a')).toBeNull();
    });

    it('refuses to remove the main worktree', async () => {
      await expect(manager.remove('main')).rejects.toThrow(/main worktree/);
    });
  });

  describe('isManaged', () => {
    it('recognises a worktree created under a different project identifier', async () => {
      // The identifier hashes the project path, and that path reaches us either
      // from git (a realpath) or from config (possibly via a symlink). Managed
      // detection must not depend on which one produced the directory.
      const wt = await manager.add({ branch: 'feat-a' });
      const strayId = join(getWorktreesRoot(), 'someproject-deadbeef');
      const moved = join(strayId, 'feat-a');
      mkdirSync(strayId, { recursive: true });
      await git.raw(['worktree', 'move', wt.path, moved]);

      const info = await manager.get('feat-a');
      expect(info).not.toBeNull();
      expect(info!.path).toBe(moved);
      expect(manager.isManaged(info!)).toBe(true);
      expect((await manager.listManagedWorktrees()).map((w) => w.name)).toContain('feat-a');

      rmSync(strayId, { recursive: true, force: true });
    });
  });

  describe('listManagedWorktrees', () => {
    it('excludes worktrees created outside the managed directory', async () => {
      const external = join(realpathSync(tmpdir()), `workon-external-${Date.now()}`);
      cleanup.push(external);
      await git.raw(['worktree', 'add', '-b', 'external-branch', external]);
      await manager.add({ branch: 'managed-branch' });

      const managed = await manager.listManagedWorktrees();
      expect(managed.map((w) => w.name)).toEqual(['managed-branch']);

      const externalInfo = await manager.get('external-branch');
      expect(externalInfo).not.toBeNull();
      expect(manager.isManaged(externalInfo!)).toBe(false);
    });
  });

  describe('hooks', () => {
    function writeSetupHook(projectDir: string, body: string) {
      mkdirSync(join(projectDir, '.workon'), { recursive: true });
      const hookPath = join(projectDir, '.workon', 'worktree-setup.sh');
      writeFileSync(hookPath, body);
      chmodSync(hookPath, 0o755);
      return hookPath;
    }

    it('runs a hook and returns its output', async () => {
      writeSetupHook(dir, '#!/bin/sh\necho "setup for $WORKTREE_NAME"\n');
      const wt = await manager.add({ branch: 'feat-a' });

      const { stdout } = await manager.runPostSetupHook(wt.path);
      expect(stdout.trim()).toBe('setup for feat-a');
    });

    it('exposes WORKTREE_PATH and PROJECT_PATH to the hook', async () => {
      writeSetupHook(dir, '#!/bin/sh\necho "$PROJECT_PATH|$WORKTREE_PATH"\n');
      const wt = await manager.add({ branch: 'feat-a' });

      const { stdout } = await manager.runPostSetupHook(wt.path);
      expect(stdout.trim()).toBe(`${dir}|${wt.path}`);
    });

    it('runs a hook from a project path containing spaces', async () => {
      // Regression: exec() handed the path to /bin/sh, which word-split it
      const spacedRoot = realpathSync(mkdtempSync(join(tmpdir(), 'workon-space-')));
      const spaced = join(spacedRoot, 'my project');
      mkdirSync(spaced);
      cleanup.push(spacedRoot);

      const spacedGit = simpleGit(spaced);
      await spacedGit.init();
      await spacedGit.addConfig('user.email', 'test@example.com');
      await spacedGit.addConfig('user.name', 'Test');
      writeFileSync(join(spaced, 'README.md'), 'hi\n');
      await spacedGit.add('.');
      await spacedGit.commit('init');
      await spacedGit.raw(['branch', '-M', 'main']);

      const spacedManager = new WorktreeManager(spaced);
      writeSetupHook(spaced, '#!/bin/sh\necho ran-in-spaced-path\n');
      const wt = await spacedManager.add({ branch: 'feat-a' });

      try {
        const { stdout } = await spacedManager.runPostSetupHook(wt.path);
        expect(stdout.trim()).toBe('ran-in-spaced-path');
      } finally {
        rmSync(spacedManager.getWorktreesDir(), { recursive: true, force: true });
      }
    });

    it("surfaces the hook's own error output when it fails", async () => {
      writeSetupHook(dir, '#!/bin/sh\necho "dependency install failed" >&2\nexit 3\n');
      const wt = await manager.add({ branch: 'feat-a' });

      await expect(manager.runPostSetupHook(wt.path)).rejects.toThrow(/dependency install failed/);
    });

    it('survives a hook that produces more than 1MB of output', async () => {
      // Regression: the default 1MB exec buffer killed chatty installers
      writeSetupHook(
        dir,
        '#!/bin/sh\ni=0\nwhile [ $i -lt 40000 ]; do echo "line $i aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; i=$((i+1)); done\n'
      );
      const wt = await manager.add({ branch: 'feat-a' });

      const { stdout } = await manager.runPostSetupHook(wt.path);
      expect(stdout.length).toBeGreaterThan(1024 * 1024);
    });

    it('runs a hook that has no shebang line', async () => {
      // exec() handed these to /bin/sh, which interprets them; execFile cannot,
      // so hooks that always worked must not break on upgrade.
      writeSetupHook(dir, 'echo no-shebang-here\n');
      const wt = await manager.add({ branch: 'feat-a' });

      const { stdout } = await manager.runPostSetupHook(wt.path);
      expect(stdout.trim()).toBe('no-shebang-here');
    });

    it('reports a missing hook clearly', async () => {
      const wt = await manager.add({ branch: 'feat-a' });
      await expect(manager.runPostSetupHook(wt.path)).rejects.toThrow(/hook not found/);
    });
  });
});
