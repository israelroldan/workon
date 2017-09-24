const { command } = require('../base');
const flatten = require('flat');

class list extends command {
    execute (params) {
        let me = this;

        let store = me.config._store;
        me.log.info(`Config file is: ${store.path}`);
        me.log.info();
        for (let [key, value] of store) {
            let obj = {};
            obj[key] = value;
            obj = flatten(obj);
            for (let name in obj) {
                me.log.info(`${name}: ${JSON.stringify(obj[name])}`);
            }
        }
    }
}

list.define({
    help: 'List configuration parameters'
});

module.exports = list;