/**
 * Test setup file - runs before all tests
 *
 * Isolates tests from the real user config by redirecting
 * the config directory to a temporary location.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeAll, afterAll } from 'vitest';

// Create a unique temp directory for this test run
const testConfigDir = mkdtempSync(join(tmpdir(), 'workon-test-'));

// Set environment variables BEFORE any Config instances are created
// This redirects `conf` package to use our temp directory
process.env.XDG_CONFIG_HOME = testConfigDir;
process.env.APPDATA = testConfigDir;

beforeAll(() => {
  // Ensure the env vars are set (they should already be from module load)
  process.env.XDG_CONFIG_HOME = testConfigDir;
  process.env.APPDATA = testConfigDir;
});

afterAll(() => {
  // Clean up the temp directory after all tests complete
  try {
    rmSync(testConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

export { testConfigDir };
