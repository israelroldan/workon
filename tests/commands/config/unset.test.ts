import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUnsetCommand } from '../../../src/commands/config/unset.js';
import { Config } from '../../../src/lib/config.js';

describe('createUnsetCommand', () => {
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
    config.delete('test_key');
  });

  it('should create a command named "unset"', () => {
    const cmd = createUnsetCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('unset');
  });

  it('should have description', () => {
    const cmd = createUnsetCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('Remove');
  });

  it('should have key argument', () => {
    const cmd = createUnsetCommand({ config, log: mockLog });
    expect(cmd.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(cmd.registeredArguments[0].name()).toBe('key');
  });

  it('should have silent option', () => {
    const cmd = createUnsetCommand({ config, log: mockLog });
    const silentOpt = cmd.options.find((o) => o.long === '--silent');
    expect(silentOpt).toBeDefined();
  });

  describe('action', () => {
    it('should remove an existing key', async () => {
      config.set('test_key', 'value');

      const cmd = createUnsetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_key'], { from: 'user' });

      expect(config.has('test_key')).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Removed test_key');
    });

    it('should report when key not found', async () => {
      const cmd = createUnsetCommand({ config, log: mockLog });
      await cmd.parseAsync(['nonexistent_key'], { from: 'user' });

      expect(consoleSpy).toHaveBeenCalledWith('Key nonexistent_key not found');
    });

    it('should suppress output with --silent', async () => {
      config.set('test_key', 'value');

      const cmd = createUnsetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_key', '--silent'], { from: 'user' });

      expect(config.has('test_key')).toBe(false);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
