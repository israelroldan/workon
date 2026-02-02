import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';
import { sanitizeForShell, escapeForSingleQuotes } from './sanitize.js';

const exec = promisify(execCallback);

/**
 * Wraps a command so it falls back to a shell when the command exits.
 * This prevents tmux panes from showing "Pane is dead" after a process ends.
 */
function wrapWithShellFallback(command: string): string {
  // Use $SHELL to get the user's preferred shell.
  // Note: We use simple $SHELL syntax (not ${SHELL:-default}) for compatibility
  // with non-POSIX shells like fish and csh that tmux may use to execute commands.
  return `${command}; exec $SHELL`;
}

export class TmuxManager {
  private sessionPrefix = 'workon-';

  async isTmuxAvailable(): Promise<boolean> {
    try {
      await exec('which tmux');
      return true;
    } catch {
      return false;
    }
  }

  async sessionExists(sessionName: string): Promise<boolean> {
    try {
      // sessionName is already sanitized by getSessionName
      await exec(`tmux has-session -t '${escapeForSingleQuotes(sessionName)}'`);
      return true;
    } catch {
      return false;
    }
  }

  getSessionName(projectName: string): string {
    // Sanitize project name to prevent shell injection
    return `${this.sessionPrefix}${sanitizeForShell(projectName)}`;
  }

  getWorktreeSessionName(projectName: string, worktreeName: string): string {
    // Session name format: workon-{project}-{worktree}
    const sanitizedProject = sanitizeForShell(projectName);
    const sanitizedWorktree = sanitizeForShell(worktreeName);
    return `${this.sessionPrefix}${sanitizedProject}-${sanitizedWorktree}`;
  }

  async killSession(sessionName: string): Promise<boolean> {
    try {
      await exec(`tmux kill-session -t '${escapeForSingleQuotes(sessionName)}'`);
      return true;
    } catch {
      return false;
    }
  }

  async createSplitSession(
    projectName: string,
    projectPath: string,
    claudeArgs: string[] = []
  ): Promise<string> {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
    const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));

    // Create new tmux session with claude in the first pane
    await exec(
      `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`
    );

    // Split window horizontally and run shell in second pane
    await exec(`tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`);

    // Set focus on claude pane (left pane)
    await exec(`tmux select-pane -t '${escapedSession}:0.0'`);

    return sessionName;
  }

  async createThreePaneSession(
    projectName: string,
    projectPath: string,
    claudeArgs: string[] = [],
    npmCommand = 'npm run dev'
  ): Promise<string> {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
    const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));
    const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

    // Create new tmux session with claude in the first pane (left side)
    await exec(
      `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`
    );

    // Split window vertically - creates right side (50/50 split)
    await exec(`tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`);

    // Split the right pane horizontally - creates top-right and bottom-right (50/50 split)
    await exec(
      `tmux split-window -v -t '${escapedSession}:0.1' -c '${escapedPath}' '${wrappedNpmCmd}'`
    );

    // Resize panes to ensure npm pane is visible (give it at least 10 lines)
    await exec(`tmux resize-pane -t '${escapedSession}:0.2' -y 10`);

    // Set focus on claude pane (left pane)
    await exec(`tmux select-pane -t '${escapedSession}:0.0'`);

    return sessionName;
  }

  async createTwoPaneNpmSession(
    projectName: string,
    projectPath: string,
    npmCommand = 'npm run dev'
  ): Promise<string> {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);
    const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    // Create new tmux session with shell in the first pane (left side)
    await exec(`tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`);

    // Split window vertically and run npm command in right pane
    await exec(
      `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}' '${wrappedNpmCmd}'`
    );

    // Set focus on terminal pane (left pane)
    await exec(`tmux select-pane -t '${escapedSession}:0.0'`);

    return sessionName;
  }

  async attachToSession(sessionName: string): Promise<void> {
    const escapedSession = escapeForSingleQuotes(sessionName);

    // Check if we're already in a tmux session
    if (process.env.TMUX) {
      // If we're already in tmux, switch to the session
      await exec(`tmux switch-client -t '${escapedSession}'`);
    } else {
      // Check if iTerm2 integration is available
      const isITerm =
        process.env.TERM_PROGRAM === 'iTerm.app' ||
        process.env.LC_TERMINAL === 'iTerm2' ||
        !!process.env.ITERM_SESSION_ID;
      const useiTermIntegration = isITerm && !process.env.TMUX_CC_NOT_SUPPORTED;

      if (useiTermIntegration) {
        // Use iTerm2 tmux integration - spawn detached to avoid blocking
        spawn('tmux', ['-CC', 'attach-session', '-t', sessionName], {
          stdio: 'inherit',
          detached: true,
        });
      } else {
        // Use regular tmux - spawn detached to avoid blocking
        spawn('tmux', ['attach-session', '-t', sessionName], {
          stdio: 'inherit',
          detached: true,
        });
      }
    }
  }

  buildShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs: string[] = []
  ): string[] {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);
    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
    const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));

    return [
      `# Create tmux split session for ${sanitizeForShell(projectName)}`,
      `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
      `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
      `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`,
      `tmux select-pane -t '${escapedSession}:0.0'`,
      this.getAttachCommand(sessionName),
    ];
  }

  buildThreePaneShellCommands(
    projectName: string,
    projectPath: string,
    claudeArgs: string[] = [],
    npmCommand = 'npm run dev'
  ): string[] {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);
    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
    const wrappedClaudeCmd = escapeForSingleQuotes(wrapWithShellFallback(claudeCommand));
    const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

    return [
      `# Create tmux three-pane session for ${sanitizeForShell(projectName)}`,
      `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
      `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}' '${wrappedClaudeCmd}'`,
      `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}'`,
      `tmux split-window -v -t '${escapedSession}:0.1' -c '${escapedPath}' '${wrappedNpmCmd}'`,
      `tmux resize-pane -t '${escapedSession}:0.2' -y 10`,
      `tmux select-pane -t '${escapedSession}:0.0'`,
      this.getAttachCommand(sessionName),
    ];
  }

  buildTwoPaneNpmShellCommands(
    projectName: string,
    projectPath: string,
    npmCommand = 'npm run dev'
  ): string[] {
    const sessionName = this.getSessionName(projectName);
    const escapedSession = escapeForSingleQuotes(sessionName);
    const escapedPath = escapeForSingleQuotes(projectPath);
    const wrappedNpmCmd = escapeForSingleQuotes(wrapWithShellFallback(npmCommand));

    return [
      `# Create tmux two-pane session with npm for ${sanitizeForShell(projectName)}`,
      `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux kill-session -t '${escapedSession}'`,
      `tmux new-session -d -s '${escapedSession}' -c '${escapedPath}'`,
      `tmux split-window -h -t '${escapedSession}' -c '${escapedPath}' '${wrappedNpmCmd}'`,
      `tmux select-pane -t '${escapedSession}:0.0'`,
      this.getAttachCommand(sessionName),
    ];
  }

  private getAttachCommand(sessionName: string): string {
    const escapedSession = escapeForSingleQuotes(sessionName);

    if (process.env.TMUX) {
      return `tmux switch-client -t '${escapedSession}'`;
    }

    const isITerm =
      process.env.TERM_PROGRAM === 'iTerm.app' ||
      process.env.LC_TERMINAL === 'iTerm2' ||
      process.env.ITERM_SESSION_ID;
    const useiTermIntegration = isITerm && !process.env.TMUX_CC_NOT_SUPPORTED;

    if (useiTermIntegration) {
      return `tmux -CC attach-session -t '${escapedSession}'`;
    }
    return `tmux attach-session -t '${escapedSession}'`;
  }

  async listWorkonSessions(): Promise<string[]> {
    try {
      const { stdout } = await exec('tmux list-sessions -F "#{session_name}"');
      return stdout
        .trim()
        .split('\n')
        .filter((session) => session.startsWith(this.sessionPrefix))
        .map((session) => session.replace(this.sessionPrefix, ''));
    } catch {
      return [];
    }
  }
}
