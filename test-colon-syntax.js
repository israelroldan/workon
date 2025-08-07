#!/usr/bin/env node

// Comprehensive test of the colon syntax feature
const { execSync } = require('child_process');

console.log('🧪 Testing Colon Syntax Feature\n');

const tests = [
    {
        name: 'All commands (backward compatibility)',
        command: 'node bin/workon test-project --shell',
        expectShellCommands: 3 // cwd, claude, npm in tmux
    },
    {
        name: 'Single command: cwd only',
        command: 'node bin/workon test-project:cwd --shell',
        expectOutput: 'cd "/users/israelroldan/code/test-project"'
    },
    {
        name: 'Single command: claude (auto-adds cwd)',
        command: 'node bin/workon test-project:claude --shell',
        expectTmux: true
    },
    {
        name: 'Multiple commands: cwd,npm',
        command: 'node bin/workon test-project:cwd,npm --shell',
        expectTmux: true
    },
    {
        name: 'Project help',
        command: 'node bin/workon test-project:help',
        expectOutput: 'Available commands for'
    },
    {
        name: 'Invalid command validation',
        command: 'node bin/workon test-project:invalid 2>&1 || true',
        expectOutput: 'Commands not configured'
    }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    try {
        console.log(`Testing: ${test.name}`);
        const output = execSync(test.command, { encoding: 'utf8', timeout: 10000 });
        
        let success = false;
        
        if (test.expectOutput) {
            success = output.includes(test.expectOutput);
        } else if (test.expectTmux) {
            success = output.includes('tmux');
        } else if (test.expectShellCommands) {
            const lines = output.trim().split('\n').filter(line => line.trim() && !line.startsWith('#') && !line.startsWith('ℹ'));
            success = lines.length >= test.expectShellCommands;
        } else {
            success = true; // Just check it doesn't crash
        }
        
        if (success) {
            console.log('   ✅ PASS');
            passed++;
        } else {
            console.log('   ❌ FAIL');
            console.log(`   Expected: ${test.expectOutput || test.expectTmux || test.expectShellCommands}`);
            console.log(`   Got: ${output.substring(0, 200)}...`);
            failed++;
        }
    } catch (error) {
        console.log('   ❌ ERROR:', error.message);
        failed++;
    }
    console.log('');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('🎉 All tests passed! Colon syntax is working perfectly.');
} else {
    console.log('⚠️  Some tests failed. Please check the implementation.');
    process.exit(1);
}