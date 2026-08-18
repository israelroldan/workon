import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TmuxManager } from '../../src/lib/tmux.js';

describe('TmuxManager', () => {
  let tmux: TmuxManager;

  beforeEach(() => {
    tmux = new TmuxManager();
  });

  describe('getSessionName', () => {
    it('should prefix session name with workon-', () => {
      expect(tmux.getSessionName('myproject')).toBe('workon-myproject');
    });

    it('should handle special characters in project name', () => {
      expect(tmux.getSessionName('my-project')).toBe('workon-my-project');
      expect(tmux.getSessionName('my_project')).toBe('workon-my_project');
    });

    it('should sanitize dangerous characters in project name', () => {
      expect(tmux.getSessionName('project$evil')).toBe('workon-project_evil');
      expect(tmux.getSessionName('project;rm')).toBe('workon-project_rm');
      expect(tmux.getSessionName("project'name")).toBe('workon-project_name');
    });
  });

  describe('buildShellCommands', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should generate shell commands for split session', () => {
      const commands = tmux.buildShellCommands('myproject', '/path/to/project');

      expect(commands).toContain('# Create tmux split session for myproject');
      expect(commands).toContain(
        "tmux has-session -t '=workon-myproject' 2>/dev/null && tmux kill-session -t '=workon-myproject'"
      );
      expect(commands).toContain(
        "tmux new-session -d -s 'workon-myproject' -c '/path/to/project' 'claude; exec $SHELL'"
      );
      expect(commands).toContain(
        "tmux split-window -h -t '=workon-myproject:' -c '/path/to/project'"
      );
      expect(commands).toContain("tmux select-pane -t '=workon-myproject:0.0'");
    });

    it('should include claude flags when provided', () => {
      const commands = tmux.buildShellCommands('myproject', '/path/to/project', [
        '--model',
        'opus',
      ]);

      expect(commands).toContain(
        "tmux new-session -d -s 'workon-myproject' -c '/path/to/project' 'claude --model opus; exec $SHELL'"
      );
    });

    it('should use tmux attach for non-tmux environment', () => {
      vi.stubEnv('TMUX', '');
      const commands = tmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands.some((c) => c.includes('attach-session'))).toBe(true);
    });

    it('should use switch-client when inside tmux', () => {
      vi.stubEnv('TMUX', '/tmp/tmux-123/default,456,0');
      const newTmux = new TmuxManager();
      const commands = newTmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands).toContain("tmux switch-client -t '=workon-myproject'");
    });
  });

  describe('buildThreePaneShellCommands', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should generate shell commands for three-pane session', () => {
      const commands = tmux.buildThreePaneShellCommands('myproject', '/path/to/project');

      expect(commands).toContain('# Create tmux three-pane session for myproject');
      expect(commands).toContain(
        "tmux split-window -v -t '=workon-myproject:0.1' -c '/path/to/project' 'npm run dev; exec $SHELL'"
      );
      expect(commands).toContain("tmux resize-pane -t '=workon-myproject:0.2' -y 10");
    });

    it('should use custom npm command', () => {
      const commands = tmux.buildThreePaneShellCommands(
        'myproject',
        '/path/to/project',
        [],
        'pnpm run start'
      );

      expect(commands.some((c) => c.includes('pnpm run start; exec $SHELL'))).toBe(true);
    });

    it('should include claude flags', () => {
      const commands = tmux.buildThreePaneShellCommands('myproject', '/path/to/project', [
        '--resume',
      ]);

      expect(commands).toContain(
        "tmux new-session -d -s 'workon-myproject' -c '/path/to/project' 'claude --resume; exec $SHELL'"
      );
    });
  });

  describe('buildTwoPaneNpmShellCommands', () => {
    it('should generate shell commands for two-pane npm session', () => {
      const commands = tmux.buildTwoPaneNpmShellCommands('myproject', '/path/to/project');

      expect(commands).toContain('# Create tmux two-pane session with npm for myproject');
      expect(commands).toContain(
        "tmux new-session -d -s 'workon-myproject' -c '/path/to/project'"
      );
      expect(commands).toContain(
        "tmux split-window -h -t '=workon-myproject:' -c '/path/to/project' 'npm run dev; exec $SHELL'"
      );
    });

    it('should use custom npm command', () => {
      const commands = tmux.buildTwoPaneNpmShellCommands(
        'myproject',
        '/path/to/project',
        'yarn start'
      );

      expect(commands.some((c) => c.includes('yarn start; exec $SHELL'))).toBe(true);
    });
  });

  describe('iTerm integration', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should use -CC flag for iTerm when TERM_PROGRAM is set', () => {
      vi.stubEnv('TMUX', '');
      vi.stubEnv('TERM_PROGRAM', 'iTerm.app');

      const newTmux = new TmuxManager();
      const commands = newTmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands).toContain("tmux -CC attach-session -t '=workon-myproject'");
    });

    it('should use -CC flag for iTerm when LC_TERMINAL is set', () => {
      vi.stubEnv('TMUX', '');
      vi.stubEnv('LC_TERMINAL', 'iTerm2');

      const newTmux = new TmuxManager();
      const commands = newTmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands).toContain("tmux -CC attach-session -t '=workon-myproject'");
    });

    it('should use -CC flag for iTerm when ITERM_SESSION_ID is set', () => {
      vi.stubEnv('TMUX', '');
      vi.stubEnv('ITERM_SESSION_ID', 'some-session-id');

      const newTmux = new TmuxManager();
      const commands = newTmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands).toContain("tmux -CC attach-session -t '=workon-myproject'");
    });

    it('should not use -CC flag when TMUX_CC_NOT_SUPPORTED is set', () => {
      vi.stubEnv('TMUX', '');
      vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
      vi.stubEnv('TMUX_CC_NOT_SUPPORTED', '1');

      const newTmux = new TmuxManager();
      const commands = newTmux.buildShellCommands('myproject', '/path/to/project');
      expect(commands).not.toContain("tmux -CC attach-session -t '=workon-myproject'");
      expect(commands).toContain("tmux attach-session -t '=workon-myproject'");
    });
  });
});
