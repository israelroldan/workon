const { command } = require('../base');

class set extends command {
    execute (params) {
        let me = this;
        me.config.set(params.key, params.value);
    }
}

set.define({
    help: {
        '': 'Set a configuration parameter',
        key: 'The configuration parameter to set',
        value: 'The value to set'
    },
    parameters: '{key} {value}'
});

module.exports = set;