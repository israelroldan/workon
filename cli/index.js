const File = require('phylo');
const {container} = require('./base');
const Config = require('../lib/config')
const omelette = require('omelette');

const {EnvironmentRecognizer} = require('../lib/environment');

const config = require('./config');
const interactive = require('./interactive');
const open = require('./open');

class workon extends container {
    constructor (log) {
        super();
        let me = this;
        me.log = log || require('loog')({
            prefixStyle: 'ascii'
        });
        me.initialize();
        me.prepareCompletion();
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
        let projects = Object.keys(me.config.get('projects')).forEach((id) => {
            tree[id] = null;
        })
        me.completion = omelette('workon').tree(tree);
        me.completion.init();
    }

    execute (params, args) {
        let me = this;
        me.log.debug('');
        
        if (params.debug) {
            me.log.setLogLevel('debug');
        }
        if (params.version) {
            me.log.info(`workon v${me.config.get('pkg').version}`);
            return true;
        } else if (params.help) {
            me.log.info('Show help');
            return true;
        } else if (params.setup) {
            me.log.debug('Configuring command-line completion');
            me.completion.setupShellInitFile();
            return true;
        } else {
            if (!me.environment) {
                return EnvironmentRecognizer.recognize(File.cwd())
                    .then((environment) => {
                        me.environment = environment;
                        return super.execute(params, args).catch((err) => {
                            if (args._args.length == 0) {
                                let interactiveCmd = me.commands.lookup('interactive').create(me);
                                return interactiveCmd.run([])
                            } else {
                                let cmdNames = me.constructor.getAspects().commands.filter((c)=>!!c).map((c)=>c.name);
                                let firstCmd = args._args.filter((a)=>!/^-/.test(a))[0];
                                if (!~cmdNames.indexOf(firstCmd)) {
                                    let openCmd = me.commands.lookup('open').create(me);
                                    return openCmd.run(args._args);
                                } else {
                                    throw err;
                                }
                            }
                        });
                    });
            }
        }
    }

    logo () {
        let version = this.config.get('pkg').version;
        return `                      8\u001b[2m${' '.repeat(Math.max(15-version.length-1, 1))+'v'+version}\u001b[22m\nYb  db  dP .d8b. 8d8b 8.dP \u001b[92m.d8b. 8d8b.\u001b[0m\n YbdPYbdP  8' .8 8P   88b  \u001b[92m8' .8 8P Y8\u001b[0m\n  YP  YP   \`Y8P' 8    8 Yb \u001b[92m\`Y8P' 8   8\u001b[0m`;
    }
}

workon.define({
    help: {
        '': 'Work on something great!',
        debug: 'Provide debug logging output',
        help: 'Show help',
        version: 'Show version',
        'setup-completion': 'Configure command line tab completion (see help for details)'
    },
    switches: '[debug:boolean=false] [version:boolean=false] [help:boolean=false] [setup-completion:boolean=false]',
    commands: {
        '': 'open',
        interactive,
        open,
        config
    }
});

module.exports = workon;