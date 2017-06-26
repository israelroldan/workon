const Conf = require('conf');

class Config {
	constructor () {
        this._transient = {};
		this._store = new Conf({
            projectName: Config.projectName,
        });
	}

    get (key, defaultValue) {
        if (Config.transientProps.indexOf(key.split('.')[0]) > -1) {
            return this._transient[key] || defaultValue;
        } else {
            return this._store.get(key, defaultValue);
        }
    }

    set (key, value) {
        if (!value) {
            this._store.set(key);
        } else {
            if (Config.transientProps.indexOf(key.split('.')[0]) > -1) {
                this._transient[key] = value;
            } else {
                this._store.set(key, value);
            }
        }
    }

    has (key) {
        if (Config.transientProps.indexOf(key.split('.')[0]) > -1) {
            return this._transient.hasOwnProperty(key);
        } else {
            return this._store.has(key);
        }
    }

    delete (key) {
        if (Config.transientProps.indexOf(key.split('.')[0]) > -1) {
            delete this._transient[key];
        } else {
            this._store.delete(key);
        }
    }
}

Config.projectName = 'workon';
Config.transientProps = ['pkg', 'work'];

module.exports = Config;