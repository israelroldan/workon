import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConfigCommand } from '../../../src/commands/config/index.js';
import { Config } from '../../../src/lib/config.js';

describe('createConfigCommand', () => {
  let config: Config;
  let mockLog: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    setLogLevel: ReturnType<typeof vi.fn>;
  };

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
  });

  it('should create a command named "config"', () => {
    const cmd = createConfigCommand({ config, log: mockLog });
    expect(cmd.name()).toBe('config');
  });

  it('should have description', () => {
    const cmd = createConfigCommand({ config, log: mockLog });
    expect(cmd.description()).toContain('configuration');
  });

  it('should have list subcommand', () => {
    const cmd = createConfigCommand({ config, log: mockLog });
    const listCmd = cmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();
  });

  it('should have set subcommand', () => {
    const cmd = createConfigCommand({ config, log: mockLog });
    const setCmd = cmd.commands.find((c) => c.name() === 'set');
    expect(setCmd).toBeDefined();
  });

  it('should have unset subcommand', () => {
    const cmd = createConfigCommand({ config, log: mockLog });
    const unsetCmd = cmd.commands.find((c) => c.name() === 'unset');
    expect(unsetCmd).toBeDefined();
  });
});
