const { command } = require('../base');

class unset extends command {
    execute (params) {
        let me = this;
        if (!params.silent && !me.config.has(params.key)) {
            throw new Error(`Unknown config ${params.key}`);
        }
        me.config.delete(params.key);
        if (!params.silent) {
            me.log.info(`Entry ${params.key} was removed from the configuration`);
        }
    }
}

unset.define({
    help: {
        '': 'Remove a configuration parameter',
        silent: 'Suppress console output',
        key: 'The configuration parameter to remove'
    },
    switches: '[silent:boolean=false]',
    parameters: '{key}'
});

module.exports = unset;