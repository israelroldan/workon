/**
 * Shell command sanitization utilities.
 * Prevents shell injection attacks from malicious project names or paths.
 */

/**
 * Sanitize a string for safe use as a shell identifier (e.g., tmux session name).
 * Only allows alphanumeric characters, underscores, hyphens, and dots.
 * All other characters are replaced with underscores.
 */
export function sanitizeForShell(input: string): string {
  if (!input) return '';
  return input.replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

/**
 * Escape a string for safe use in a double-quoted shell context.
 * Escapes characters that have special meaning in double quotes: $, `, \, ", !
 */
export function escapeShellArg(input: string): string {
  if (!input) return '';
  return input.replace(/([\\$`"!])/g, '\\$1');
}

/**
 * Escape a string for safe use in a single-quoted shell context.
 * Single quotes prevent all interpolation, but we need to handle
 * embedded single quotes by ending the string, adding an escaped quote,
 * and restarting the string.
 */
export function escapeForSingleQuotes(input: string): string {
  if (!input) return '';
  return input.replace(/'/g, "'\\''");
}
