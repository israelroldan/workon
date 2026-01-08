import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

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
      await exec(`tmux has-session -t "${sessionName}"`);
      return true;
    } catch {
      return false;
    }
  }

  getSessionName(projectName: string): string {
    return `${this.sessionPrefix}${projectName}`;
  }

  async killSession(sessionName: string): Promise<boolean> {
    try {
      await exec(`tmux kill-session -t "${sessionName}"`);
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

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

    // Create new tmux session with claude in the first pane
    await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`);

    // Split window horizontally and run shell in second pane
    await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}"`);

    // Set focus on claude pane (left pane)
    await exec(`tmux select-pane -t "${sessionName}:0.0"`);

    return sessionName;
  }

  async createThreePaneSession(
    projectName: string,
    projectPath: string,
    claudeArgs: string[] = [],
    npmCommand = 'npm run dev'
  ): Promise<string> {
    const sessionName = this.getSessionName(projectName);

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

    // Create new tmux session with claude in the first pane (left side)
    await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`);

    // Split window vertically - creates right side (50/50 split)
    await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}"`);

    // Split the right pane horizontally - creates top-right and bottom-right (50/50 split)
    await exec(`tmux split-window -v -t "${sessionName}:0.1" -c "${projectPath}" '${npmCommand}'`);

    // Set remain-on-exit to keep pane open if command fails
    await exec(`tmux set-option -t "${sessionName}:0.2" remain-on-exit on`);

    // Resize panes to ensure npm pane is visible (give it at least 10 lines)
    await exec(`tmux resize-pane -t "${sessionName}:0.2" -y 10`);

    // Set focus on claude pane (left pane)
    await exec(`tmux select-pane -t "${sessionName}:0.0"`);

    return sessionName;
  }

  async createTwoPaneNpmSession(
    projectName: string,
    projectPath: string,
    npmCommand = 'npm run dev'
  ): Promise<string> {
    const sessionName = this.getSessionName(projectName);

    // Kill existing session if it exists
    if (await this.sessionExists(sessionName)) {
      await this.killSession(sessionName);
    }

    // Create new tmux session with shell in the first pane (left side)
    await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}"`);

    // Split window vertically and run npm command in right pane
    await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}" '${npmCommand}'`);

    // Set remain-on-exit to keep pane open if command fails
    await exec(`tmux set-option -t "${sessionName}:0.1" remain-on-exit on`);

    // Set focus on terminal pane (left pane)
    await exec(`tmux select-pane -t "${sessionName}:0.0"`);

    return sessionName;
  }

  async attachToSession(sessionName: string): Promise<void> {
    // Check if we're already in a tmux session
    if (process.env.TMUX) {
      // If we're already in tmux, switch to the session
      await exec(`tmux switch-client -t "${sessionName}"`);
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
    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

    return [
      `# Create tmux split session for ${projectName}`,
      `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
      `tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`,
      `tmux split-window -h -t "${sessionName}" -c "${projectPath}"`,
      `tmux select-pane -t "${sessionName}:0.0"`,
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
    const claudeCommand = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';

    return [
      `# Create tmux three-pane session for ${projectName}`,
      `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
      `tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`,
      `tmux split-window -h -t "${sessionName}" -c "${projectPath}"`,
      `tmux split-window -v -t "${sessionName}:0.1" -c "${projectPath}" '${npmCommand}'`,
      `tmux set-option -t "${sessionName}:0.2" remain-on-exit on`,
      `tmux resize-pane -t "${sessionName}:0.2" -y 10`,
      `tmux select-pane -t "${sessionName}:0.0"`,
      this.getAttachCommand(sessionName),
    ];
  }

  buildTwoPaneNpmShellCommands(
    projectName: string,
    projectPath: string,
    npmCommand = 'npm run dev'
  ): string[] {
    const sessionName = this.getSessionName(projectName);

    return [
      `# Create tmux two-pane session with npm for ${projectName}`,
      `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
      `tmux new-session -d -s "${sessionName}" -c "${projectPath}"`,
      `tmux split-window -h -t "${sessionName}" -c "${projectPath}" '${npmCommand}'`,
      `tmux set-option -t "${sessionName}:0.1" remain-on-exit on`,
      `tmux select-pane -t "${sessionName}:0.0"`,
      this.getAttachCommand(sessionName),
    ];
  }

  private getAttachCommand(sessionName: string): string {
    if (process.env.TMUX) {
      return `tmux switch-client -t "${sessionName}"`;
    }

    const isITerm =
      process.env.TERM_PROGRAM === 'iTerm.app' ||
      process.env.LC_TERMINAL === 'iTerm2' ||
      process.env.ITERM_SESSION_ID;
    const useiTermIntegration = isITerm && !process.env.TMUX_CC_NOT_SUPPORTED;

    if (useiTermIntegration) {
      return `tmux -CC attach-session -t "${sessionName}"`;
    }
    return `tmux attach-session -t "${sessionName}"`;
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
