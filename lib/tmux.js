const { spawn } = require('child_process');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

class TmuxManager {
    constructor() {
        this.sessionPrefix = 'workon-';
    }

    async isTmuxAvailable() {
        try {
            await exec('which tmux');
            return true;
        } catch {
            return false;
        }
    }

    async sessionExists(sessionName) {
        try {
            await exec(`tmux has-session -t "${sessionName}"`);
            return true;
        } catch {
            return false;
        }
    }

    getSessionName(projectName) {
        return `${this.sessionPrefix}${projectName}`;
    }

    async killSession(sessionName) {
        try {
            await exec(`tmux kill-session -t "${sessionName}"`);
            return true;
        } catch {
            return false;
        }
    }

    async createSplitSession(projectName, projectPath, claudeArgs = []) {
        const sessionName = this.getSessionName(projectName);
        
        // Kill existing session if it exists
        if (await this.sessionExists(sessionName)) {
            await this.killSession(sessionName);
        }

        const claudeCommand = claudeArgs.length > 0 
            ? `claude ${claudeArgs.join(' ')}`
            : 'claude';

        // Create new tmux session with claude in the first pane
        await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`);
        
        // Split window horizontally and run shell in second pane
        await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}"`);
        
        // Set focus on claude pane (left pane)
        await exec(`tmux select-pane -t "${sessionName}:0.0"`);

        return sessionName;
    }

    async createThreePaneSession(projectName, projectPath, claudeArgs = [], npmCommand = 'npm run dev') {
        const sessionName = this.getSessionName(projectName);
        
        // Kill existing session if it exists
        if (await this.sessionExists(sessionName)) {
            await this.killSession(sessionName);
        }

        const claudeCommand = claudeArgs.length > 0 
            ? `claude ${claudeArgs.join(' ')}`
            : 'claude';

        // Create new tmux session with claude in the first pane (left side)
        await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`);
        
        // Split window vertically - creates right side
        await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}"`);
        
        // Split the right pane horizontally - creates top-right and bottom-right
        await exec(`tmux split-window -v -t "${sessionName}:0.1" -c "${projectPath}" '${npmCommand}'`);
        
        // Set focus on claude pane (left pane)
        await exec(`tmux select-pane -t "${sessionName}:0.0"`);

        return sessionName;
    }

    async createTwoPaneNpmSession(projectName, projectPath, npmCommand = 'npm run dev') {
        const sessionName = this.getSessionName(projectName);
        
        // Kill existing session if it exists
        if (await this.sessionExists(sessionName)) {
            await this.killSession(sessionName);
        }

        // Create new tmux session with shell in the first pane (left side)
        await exec(`tmux new-session -d -s "${sessionName}" -c "${projectPath}"`);
        
        // Split window vertically and run npm command in right pane
        await exec(`tmux split-window -h -t "${sessionName}" -c "${projectPath}" '${npmCommand}'`);
        
        // Set focus on terminal pane (left pane)
        await exec(`tmux select-pane -t "${sessionName}:0.0"`);

        return sessionName;
    }

    async attachToSession(sessionName) {
        // Check if we're already in a tmux session
        if (process.env.TMUX) {
            // If we're already in tmux, switch to the session
            await exec(`tmux switch-client -t "${sessionName}"`);
        } else {
            // If not in tmux, attach to the session
            spawn('tmux', ['-CC', 'attach-session', '-t', sessionName], {
                stdio: 'inherit'
            });
        }
    }

    buildShellCommands(projectName, projectPath, claudeArgs = []) {
        const sessionName = this.getSessionName(projectName);
        const claudeCommand = claudeArgs.length > 0 
            ? `claude ${claudeArgs.join(' ')}`
            : 'claude';

        return [
            `# Create tmux split session for ${projectName}`,
            `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
            `tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`,
            `tmux split-window -h -t "${sessionName}" -c "${projectPath}"`,
            `tmux select-pane -t "${sessionName}:0.0"`,
            process.env.TMUX 
                ? `tmux switch-client -t "${sessionName}"`
                : `tmux attach-session -t "${sessionName}"`
        ];
    }

    buildThreePaneShellCommands(projectName, projectPath, claudeArgs = [], npmCommand = 'npm run dev') {
        const sessionName = this.getSessionName(projectName);
        const claudeCommand = claudeArgs.length > 0 
            ? `claude ${claudeArgs.join(' ')}`
            : 'claude';

        return [
            `# Create tmux three-pane session for ${projectName}`,
            `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
            `tmux new-session -d -s "${sessionName}" -c "${projectPath}" '${claudeCommand}'`,
            `tmux split-window -h -t "${sessionName}" -c "${projectPath}"`,
            `tmux split-window -v -t "${sessionName}:0.1" -c "${projectPath}" '${npmCommand}'`,
            `tmux select-pane -t "${sessionName}:0.0"`,
            process.env.TMUX 
                ? `tmux switch-client -t "${sessionName}"`
                : `tmux attach-session -t "${sessionName}"`
        ];
    }

    buildTwoPaneNpmShellCommands(projectName, projectPath, npmCommand = 'npm run dev') {
        const sessionName = this.getSessionName(projectName);

        return [
            `# Create tmux two-pane session with npm for ${projectName}`,
            `tmux has-session -t "${sessionName}" 2>/dev/null && tmux kill-session -t "${sessionName}"`,
            `tmux new-session -d -s "${sessionName}" -c "${projectPath}"`,
            `tmux split-window -h -t "${sessionName}" -c "${projectPath}" '${npmCommand}'`,
            `tmux select-pane -t "${sessionName}:0.0"`,
            process.env.TMUX 
                ? `tmux switch-client -t "${sessionName}"`
                : `tmux attach-session -t "${sessionName}"`
        ];
    }

    async listWorkonSessions() {
        try {
            const { stdout } = await exec('tmux list-sessions -F "#{session_name}"');
            return stdout.trim()
                .split('\n')
                .filter(session => session.startsWith(this.sessionPrefix))
                .map(session => session.replace(this.sessionPrefix, ''));
        } catch {
            return [];
        }
    }
}

module.exports = TmuxManager;