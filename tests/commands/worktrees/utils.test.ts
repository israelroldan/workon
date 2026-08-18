import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { simpleGit } from 'simple-git';
import { detectWorktreeContext } from '../../../src/commands/worktrees/utils.js';

const originalHome = process.env.HOME;
const created: string[] = [];

beforeAll(() => {
  // Managed worktrees live under $HOME/.workon - keep them in a sandbox
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'workon-home-')));
  created.push(home);
  process.env.HOME = home;
});

afterAll(() => {
  process.env.HOME = originalHome;
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

async function seedRepo(dir: string) {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  await git.add('.');
  await git.commit('init');
  await git.raw(['branch', '-M', 'main']);
  return git;
}

describe('detectWorktreeContext', () => {
  it('returns null outside a git repository', async () => {
    expect(await detectWorktreeContext(tempDir('workon-nogit-'))).toBeNull();
  });

  it('reports the main repository', async () => {
    const dir = tempDir('workon-main-');
    await seedRepo(dir);

    const info = await detectWorktreeContext(dir);
    expect(info).not.toBeNull();
    expect(info!.isWorktree).toBe(false);
    expect(info!.mainRepoPath).toBe(dir);
    expect(info!.worktreeName).toBeNull();
  });

  it('reports the worktree and its main repo from inside a worktree', async () => {
    const dir = tempDir('workon-wtmain-');
    const git = await seedRepo(dir);
    const wtRoot = tempDir('workon-wtroot-');
    const wtPath = join(wtRoot, 'feat-a');
    await git.raw(['worktree', 'add', '-b', 'feat/a', wtPath]);

    const info = await detectWorktreeContext(wtPath);
    expect(info!.isWorktree).toBe(true);
    expect(info!.mainRepoPath).toBe(dir);
    expect(info!.worktreePath).toBe(realpathSync(wtPath));
    expect(info!.branch).toBe('feat/a');
    // External worktree: named after its branch, in directory form
    expect(info!.worktreeName).toBe('feat-a');
  });

  it('resolves the main repo for a worktree of a bare repository', async () => {
    // Regression: mainRepoPath was dirname(--git-common-dir), which for a bare
    // repo pointed at the repo's *parent* directory rather than the repo.
    const parent = tempDir('workon-bare-');
    const source = join(parent, 'source');
    const bare = join(parent, 'repo.git');
    mkdirSync(source);
    await seedRepo(source);
    await simpleGit(parent).clone(source, bare, ['--bare']);

    const wtPath = join(parent, 'feat-b');
    await simpleGit(bare).raw(['worktree', 'add', '-b', 'feat-b', wtPath]);

    const info = await detectWorktreeContext(wtPath);
    expect(info!.isWorktree).toBe(true);
    expect(info!.mainRepoPath).toBe(realpathSync(bare));
    expect(info!.mainRepoPath).not.toBe(parent);
  });

  it('detects a subdirectory of a worktree as that worktree', async () => {
    const dir = tempDir('workon-sub-');
    const git = await seedRepo(dir);
    const wtRoot = tempDir('workon-subwt-');
    const wtPath = join(wtRoot, 'feat-c');
    await git.raw(['worktree', 'add', '-b', 'feat-c', wtPath]);
    const nested = join(wtPath, 'src');
    mkdirSync(nested);

    const info = await detectWorktreeContext(nested);
    expect(info!.isWorktree).toBe(true);
    expect(info!.worktreePath).toBe(realpathSync(wtPath));
    expect(info!.mainRepoPath).toBe(dir);
  });
});
