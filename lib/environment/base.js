const deepAssign = require('deep-assign');

class Environment {
    constructor (config) {
        deepAssign(this, config);
    }
}

Environment.$isEnvironment = true;
Environment.prototype.$isEnvironment = true;

module.exports = Environment