const { command } = require('../base');

class unset extends command {
    execute (params) {
        let me = this;

        me.log.info('unset config here');
    }
}

unset.define({});

module.exports = unset;