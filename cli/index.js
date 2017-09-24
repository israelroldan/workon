const {container} = require('./base');

const File = require('phylo');

const Config = require('../lib/config');
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
        Object.keys(me.config.get('projects')).forEach((id) => {
            tree[id] = null;
        });
        me.completion = require('omelette')('workon').tree(tree);
        me.completion.init();
    }

    execute (params, args) {
        let me = this;

        if (params.debug) {
            me.log.setLogLevel('debug');
        }

        if (params['setup-completion']) {
            me.log.debug('Configuring command-line completion');
            me.completion.setupShellInitFile();
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

    maybeOpen (err, args) {
        let me = this;
        let cmdNames = me.constructor.getAspects().commands.filter((c) => !!c).map((c) => c.name);
        let firstCmd = args._args.filter((a) => !/^-/.test(a))[0];
        if (!~cmdNames.indexOf(firstCmd)) {
            // ex. "workon projectName"
            return me.commands.lookup('open').create(me).run(args._args);
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
        'setup-completion': 'Configure command line tab completion (see help for details)'
    },
    switches: '[d#debug:boolean=false] [setup-completion:boolean=false]',
    commands: {
        '': 'open',
        interactive: {
            type: interactive,
            private: true
        },
        open,
        config
    }
});

module.exports = workon;