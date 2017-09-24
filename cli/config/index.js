const { container } = require('../base');

const list = require('./list');
const set = require('./set');
const unset = require('./unset');

class config extends container {}

config.define({
    help: 'manage configuration parameters',
    commands: {
        '': 'list',
        list,
        set,
        unset
    }
});

module.exports = config;