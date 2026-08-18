import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { detectDefaultRemoteBranch, resolveRemote } from '../../src/commands/worktree.js';

/**
 * These probe git for refs that are expected to be missing. `--quiet` git
 * commands exit non-zero *silently*, and simple-git only reports a command as
 * failed when it writes to stderr - so a lookup that infers failure from a
 * thrown error silently reports the first candidate for every repository.
 */

const created: string[] = [];

afterAll(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** A repo with `origin` pointing at a bare repo whose default branch is `branch` */
async function repoWithRemote(branch: string): Promise<SimpleGit> {
  const root = tempDir(`workon-remote-${branch}-`);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  await simpleGit(root).raw(['init', '--bare', origin]);

  const git = simpleGit(root);
  await git.clone(origin, work);
  const repo = simpleGit(work);
  await repo.addConfig('user.email', 'test@example.com');
  await repo.addConfig('user.name', 'Test');
  writeFileSync(join(work, 'README.md'), 'hi\n');
  await repo.add('.');
  await repo.commit('init');
  await repo.raw(['branch', '-M', branch]);
  await repo.push(['-u', 'origin', branch]);

  // `git clone` of an empty repo leaves no origin/HEAD, which is also the state
  // of any repo whose remote was added by hand.
  await repo.raw(['remote', 'set-head', 'origin', '--delete']).catch(() => {});
  return repo;
}

describe('detectDefaultRemoteBranch', () => {
  let mainRepo: SimpleGit;
  let masterRepo: SimpleGit;
  let developRepo: SimpleGit;

  beforeAll(async () => {
    mainRepo = await repoWithRemote('main');
    masterRepo = await repoWithRemote('master');
    developRepo = await repoWithRemote('develop');
  }, 60_000);

  it('detects main', async () => {
    expect(await detectDefaultRemoteBranch(mainRepo, 'origin')).toBe('main');
  });

  it('detects master rather than assuming main', async () => {
    expect(await detectDefaultRemoteBranch(masterRepo, 'origin')).toBe('master');
  });

  it('detects develop rather than assuming main', async () => {
    // Regression: probing with `rev-parse --verify --quiet` inside a try/catch
    // never threw, so the first candidate ('main') was always returned.
    expect(await detectDefaultRemoteBranch(developRepo, 'origin')).toBe('develop');
  });

  it('prefers what origin/HEAD points at', async () => {
    const repo = await repoWithRemote('trunk-a');
    await repo.raw(['branch', 'main']);
    await repo.push('origin', 'main');
    await repo.fetch();
    await repo.raw(['remote', 'set-head', 'origin', 'trunk-a']);

    expect(await detectDefaultRemoteBranch(repo, 'origin')).toBe('trunk-a');
  }, 30_000);

  it('returns null when no known default branch exists', async () => {
    const repo = await repoWithRemote('trunk-b');
    expect(await detectDefaultRemoteBranch(repo, 'origin')).toBeNull();
  }, 30_000);
});

describe('resolveRemote', () => {
  it('returns null when the repo has no remotes', async () => {
    const dir = tempDir('workon-noremote-');
    const git = simpleGit(dir);
    await git.init();
    expect(await resolveRemote(git)).toBeNull();
  });

  it('prefers origin', async () => {
    const dir = tempDir('workon-origin-');
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('upstream', 'https://example.com/u.git');
    await git.addRemote('origin', 'https://example.com/o.git');
    expect(await resolveRemote(git)).toBe('origin');
  });

  it('uses the only remote when it is not called origin', async () => {
    const dir = tempDir('workon-single-');
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('fork', 'https://example.com/f.git');
    expect(await resolveRemote(git)).toBe('fork');
  });

  it('refuses to guess between several non-origin remotes', async () => {
    const dir = tempDir('workon-many-');
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('fork', 'https://example.com/f.git');
    await git.addRemote('upstream', 'https://example.com/u.git');
    expect(await resolveRemote(git)).toBeNull();
  });
});
