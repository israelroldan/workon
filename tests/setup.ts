/**
 * Test setup file - runs before all tests
 *
 * Isolates tests from the real user config by redirecting
 * the config directory to a temporary location.
 *
 * IMPORTANT: On macOS, the `conf` package ignores XDG_CONFIG_HOME and uses
 * ~/Library/Preferences instead. We use WORKON_CONFIG_DIR to override this.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeAll, afterAll, beforeEach } from 'vitest';

// Create a unique temp directory for this test run
const testConfigDir = mkdtempSync(join(tmpdir(), 'workon-test-'));

// Set environment variables BEFORE any Config instances are created
// WORKON_CONFIG_DIR is checked by our Config class to override the config path
// This works on all platforms including macOS
process.env.WORKON_CONFIG_DIR = testConfigDir;
// Enable test mode to allow multiple Config instances
process.env.NODE_ENV = 'test';

beforeAll(() => {
  // Ensure the env vars are set (they should already be from module load)
  process.env.WORKON_CONFIG_DIR = testConfigDir;
  process.env.NODE_ENV = 'test';
});

beforeEach(async () => {
  // Reset the Config singleton before each test to ensure test isolation
  const { Config } = await import('../src/lib/config.js');
  Config.resetInstance();
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
