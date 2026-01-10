import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSetCommand } from '../../../src/commands/config/set.js';
import { Config } from '../../../src/lib/config.js';

describe('createSetCommand', () => {
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
    config.delete('test_bool');
    config.delete('test_number');
    config.delete('test_json');
  });

  it('should create a command named "set"', () => {
    const cmd = createSetCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('set');
  });

  it('should have description', () => {
    const cmd = createSetCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('Set');
  });

  it('should have key argument', () => {
    const cmd = createSetCommand({ config, log: mockLog });
    expect(cmd.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(cmd.registeredArguments[0].name()).toBe('key');
  });

  it('should have value argument', () => {
    const cmd = createSetCommand({ config, log: mockLog });
    expect(cmd.registeredArguments.length).toBeGreaterThanOrEqual(2);
    expect(cmd.registeredArguments[1].name()).toBe('value');
  });

  describe('action', () => {
    it('should set a string value', async () => {
      const cmd = createSetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_key', 'myvalue'], { from: 'user' });

      expect(config.get('test_key')).toBe('myvalue');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Set test_key'));
    });

    it('should set a boolean true value', async () => {
      const cmd = createSetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_bool', 'true'], { from: 'user' });

      expect(config.get('test_bool')).toBe(true);
    });

    it('should set a boolean false value', async () => {
      const cmd = createSetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_bool', 'false'], { from: 'user' });

      expect(config.get('test_bool')).toBe(false);
    });

    it('should set a number value', async () => {
      const cmd = createSetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_number', '42'], { from: 'user' });

      expect(config.get('test_number')).toBe(42);
    });

    it('should set a JSON object value', async () => {
      const cmd = createSetCommand({ config, log: mockLog });
      await cmd.parseAsync(['test_json', '{"key":"value"}'], { from: 'user' });

      expect(config.get('test_json')).toEqual({ key: 'value' });
    });
  });
});
