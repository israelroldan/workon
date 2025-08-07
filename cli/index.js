const {container} = require('./base');

const File = require('phylo');

const Config = require('../lib/config');
const {EnvironmentRecognizer} = require('../lib/environment');

const config = require('./config');
const interactive = require('./interactive');
const open = require('./open');
const manage = require('./manage');

class workon extends container {
    constructor (log) {
        super();
        let me = this;
        me.log = log || require('loog')({
            prefixStyle: 'ascii'
        });
    }

    run () {
        let me = this;
        me.initialize();
        me.prepareCompletion();
        return super.run();
    }

    initialize () {
        let me = this;
        me.log.debug('Log system initialized');
        me.rootDir = File.from(__dirname).up('package.json');
        me.log.debug(`Using ${me.rootDir} as root directory`);
        me.config = new Config();
        me.log.debug('Configuration system initialized');
        me.log.debug("Loading package config, 'pkg' namespace");
        me.config.set('pkg', me.rootDir.join('package.json').load());
        EnvironmentRecognizer.configure(me.config, me.log);
    }

    prepareCompletion () {
        let me = this;
        let tree = {
            config: [
                'list', 'set', 'reset'
            ]
        };
        let projects = me.config.get('projects');
        if (projects) {
            Object.keys(projects).forEach((id) => {
                tree[id] = null;
            });
        }
        me.completion = require('omelette')('workon').tree(tree);
        me.completion.init();
    }

    execute (params, args) {
        let me = this;

        if (params.debug) {
            me.log.setLogLevel('debug');
        }

        if (params.completion) {
            me.log.debug('Setting up command-line completion');
            me.completion.setupShellInitFile();
            return true;
        } else if (params.init) {
            me.log.debug('Generating shell integration function');
            me.outputShellInit();
            return true;
        } else {
            let prom = Promise.resolve();
            if (!me.environment) {
                prom = EnvironmentRecognizer.recognize(File.cwd())
                    .then((environment) => {
                        me.environment = environment;
                    });
            }
            return prom.then(() => super.execute(params, args).catch((err) => me.maybeOpen(err, args)));
        }
    }

    outputShellInit () {
        let me = this;
        
        // Get list of available commands from switchit
        let cmdNames = me.constructor.getAspects().commands.filter((c) => !!c).map((c) => c.name);
        
        // Get list of available switches from switchit
        let switches = me.constructor.getAspects().switches || [];
        let switchFlags = [];
        switches.forEach(sw => {
            switchFlags.push('--' + sw.name);
            if (sw.char) {
                switchFlags.push('-' + sw.char);
            }
        });
        
        // Add built-in switchit flags (help and version are automatically added by switchit)
        let builtinFlags = ['--help', '-h', '--version', '-v', 'help'];
        
        // Combine all non-shell commands and flags, removing duplicates
        let nonShellCommands = [...new Set(cmdNames.concat(switchFlags).concat(builtinFlags))];
        let casePattern = nonShellCommands.join('|');
        
        // Generate shell function that wraps workon calls
        let shellFunction = `
# workon shell integration
workon() {
    # Commands and flags that should NOT use shell mode
    case "$1" in
        ${casePattern})
            command workon "$@"
            return $?
            ;;
    esac
    
    # If no arguments provided, run interactive mode directly
    if [[ $# -eq 0 ]]; then
        command workon "$@"
        return $?
    fi
    
    # Default behavior: use shell mode for project opening
    local output
    output=$(command workon --shell "$@" 2>&1)
    local exit_code=$?
    
    if [[ $exit_code -eq 0 && -n "$output" ]]; then
        # Execute shell commands if workon succeeded and output exists
        eval "$output"
    else
        # Show any error output
        [[ -n "$output" ]] && echo "$output" >&2
        return $exit_code
    fi
}`;
        console.log(shellFunction);
    }

    maybeOpen (err, args) {
        let me = this;
        let cmdNames = me.constructor.getAspects().commands.filter((c) => !!c).map((c) => c.name);
        let firstCmd = args._args.filter((a) => !/^-/.test(a))[0];
        if (!~cmdNames.indexOf(firstCmd)) {
            // ex. "workon projectName"
            let openCmd = me.commands.lookup('open').create(me);
            // Copy shell parameter to the open command
            if (me.params.shell) {
                openCmd.params = openCmd.params || {};
                openCmd.params.shell = true;
            }
            return openCmd.run(args._args);
        } else {
            // ex. "workon config asdf"
            throw err;
        }
    }
}

workon.define({
    help: {
        '': 'Work on something great!',
        debug: 'Provide debug logging output',
        completion: 'Configure and generate shell tab completion',
        shell: 'Output shell commands instead of spawning processes',
        init: 'Generate shell integration function for seamless directory switching'
    },
    switches: '[d#debug:boolean=false] [completion:boolean=false] [shell:boolean=false] [init:boolean=false]',
    commands: {
        '': 'open',
        interactive: {
            type: interactive,
            private: true
        },
        open,
        config,
        manage
    }
});

module.exports = workon;