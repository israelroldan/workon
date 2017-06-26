const { Container, Command } = require('switchit');

module.exports.command = class basecommand extends Command {
    attach (parent) {
        super.attach(parent);
        let root = this.root();
        this.log = root.log;
        this.config = root.config;
        this.rootDir = root.rootDir;
        return this;
    }
};

module.exports.container = class basecontainer extends Container {

};
