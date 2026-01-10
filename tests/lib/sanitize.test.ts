import { describe, it, expect } from 'vitest';
import {
  sanitizeForShell,
  escapeShellArg,
  escapeForSingleQuotes,
} from '../../src/lib/sanitize.js';

describe('sanitizeForShell', () => {
  it('should allow alphanumeric characters', () => {
    expect(sanitizeForShell('myProject123')).toBe('myProject123');
  });

  it('should allow underscores', () => {
    expect(sanitizeForShell('my_project')).toBe('my_project');
  });

  it('should allow hyphens', () => {
    expect(sanitizeForShell('my-project')).toBe('my-project');
  });

  it('should allow dots', () => {
    expect(sanitizeForShell('my.project')).toBe('my.project');
  });

  it('should replace spaces with underscores', () => {
    expect(sanitizeForShell('my project')).toBe('my_project');
  });

  it('should replace special shell characters with underscores', () => {
    expect(sanitizeForShell('project$evil')).toBe('project_evil');
    expect(sanitizeForShell('project`cmd`')).toBe('project_cmd_');
    expect(sanitizeForShell('project;rm -rf')).toBe('project_rm_-rf'); // hyphen is allowed
    expect(sanitizeForShell('project|cat')).toBe('project_cat');
    expect(sanitizeForShell('project&bg')).toBe('project_bg');
  });

  it('should replace quotes with underscores', () => {
    expect(sanitizeForShell("project'name")).toBe('project_name');
    expect(sanitizeForShell('project"name')).toBe('project_name');
  });

  it('should handle empty string', () => {
    expect(sanitizeForShell('')).toBe('');
  });

  it('should handle string with only special characters', () => {
    expect(sanitizeForShell('$`|&;')).toBe('_____');
  });

  it('should handle unicode characters', () => {
    expect(sanitizeForShell('project🚀name')).toBe('project__name');
  });
});

describe('escapeShellArg', () => {
  it('should escape dollar signs', () => {
    expect(escapeShellArg('$HOME')).toBe('\\$HOME');
  });

  it('should escape backticks', () => {
    expect(escapeShellArg('`whoami`')).toBe('\\`whoami\\`');
  });

  it('should escape backslashes', () => {
    expect(escapeShellArg('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('should escape double quotes', () => {
    expect(escapeShellArg('say "hello"')).toBe('say \\"hello\\"');
  });

  it('should escape exclamation marks', () => {
    expect(escapeShellArg('hello!')).toBe('hello\\!');
  });

  it('should handle multiple special characters', () => {
    expect(escapeShellArg('$HOME/`cmd`!"test"')).toBe('\\$HOME/\\`cmd\\`\\!\\"test\\"');
  });

  it('should handle empty string', () => {
    expect(escapeShellArg('')).toBe('');
  });

  it('should leave safe characters unchanged', () => {
    expect(escapeShellArg('safe-path_123.txt')).toBe('safe-path_123.txt');
  });
});

describe('escapeForSingleQuotes', () => {
  it('should escape single quotes', () => {
    expect(escapeForSingleQuotes("it's")).toBe("it'\\''s");
  });

  it('should handle multiple single quotes', () => {
    expect(escapeForSingleQuotes("it's a 'test'")).toBe("it'\\''s a '\\''test'\\''");
  });

  it('should handle empty string', () => {
    expect(escapeForSingleQuotes('')).toBe('');
  });

  it('should leave strings without single quotes unchanged', () => {
    expect(escapeForSingleQuotes('no quotes here')).toBe('no quotes here');
  });

  it('should leave special characters (except single quote) unchanged', () => {
    // In single quotes, special chars are literal
    expect(escapeForSingleQuotes('$HOME `cmd`')).toBe('$HOME `cmd`');
  });
});
