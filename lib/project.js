const File = require('phylo');
const deepAssign = require('deep-assign');

class Project {
    constructor (name, cfg, defaults) {
        this._defaults = defaults = defaults || {};
        this._initialCfg = cfg = cfg || {};

        if (!('name' in cfg)) {
            cfg.name = name;
        }
        
        if (!('path' in cfg)) {
            cfg.path = name;
        }
        deepAssign(this, deepAssign(defaults, cfg));
    }

    set base (path) {
        this._base = File.from(path).absolutify();
    }

    get base () {
        return this._base;
    }

    set ide (cmd) {
        this._ide = cmd;
    }

    get ide () {
        return this._ide;
    }

    set events (eventCfg) {
        this._eventCfg = eventCfg;
    }

    get events () {
        return this._eventCfg;
    }

    set path (path) {
        if (this._base) {
            this._path = this._base.join(path);
        } else {
            this._path = File.from(path);
        }
        this._path = this._path.absolutify();
    }

    get path () {
        return this._path;
    }

    set branch (branch) {
        this._branch = branch;
    }

    get branch () {
        return this._branch;
    }
}

Project.$isProject = true;
Project.prototype.$isProject = true;

module.exports = Project;