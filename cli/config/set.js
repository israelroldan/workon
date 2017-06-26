const { command } = require('../base');

class set extends command {
    execute (params) {
        let me = this;

        me.log.info('set config here');
    }
}

set.define({});

module.exports = set;