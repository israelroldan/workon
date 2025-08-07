const registry = require('./commands/registry');

async function testRegistry() {
    console.log('Testing Command Registry...\n');
    
    try {
        await registry.initialize();
        console.log('✅ Registry initialized successfully\n');
        
        // Test getting valid event names
        const eventNames = registry.getValidEventNames();
        console.log('Valid event names:', eventNames);
        
        // Test getting commands for manage UI
        const manageCommands = registry.getCommandsForManageUI();
        console.log('\nCommands for manage UI:');
        manageCommands.forEach(cmd => {
            console.log(`  - ${cmd.name} (${cmd.value}): ${cmd.description}`);
        });
        
        // Test getting specific commands
        console.log('\nTesting specific commands:');
        const cwdCommand = registry.getCommandByName('cwd');
        if (cwdCommand) {
            console.log('✅ CWD command found');
            console.log('   Metadata:', cwdCommand.metadata);
        }
        
        const claudeCommand = registry.getCommandByName('claude');
        if (claudeCommand) {
            console.log('✅ Claude command found');
            console.log('   Metadata:', claudeCommand.metadata);
        }
        
        // Test tmux commands
        const tmuxCommands = registry.getTmuxEnabledCommands();
        console.log('\nTmux-enabled commands:');
        tmuxCommands.forEach(cmd => {
            console.log(`  - ${cmd.name} (priority: ${cmd.priority})`);
        });
        
        // Test validation
        console.log('\nTesting validation:');
        if (cwdCommand) {
            console.log('CWD validation (true):', cwdCommand.validation.validateConfig(true));
            console.log('CWD validation (invalid):', cwdCommand.validation.validateConfig(123));
        }
        
        console.log('\n✅ All tests passed!');
        
    } catch (error) {
        console.error('❌ Error testing registry:', error.message);
        console.error(error.stack);
    }
}

testRegistry();