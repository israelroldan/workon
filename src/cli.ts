#!/usr/bin/env node

// Workaround for Node.js stdout buffering issues with interactive prompts
// This ensures stdout is in the correct mode before any prompts are shown
if (process.stdout.isTTY) {
  process.stdout.write('');
}

import { createCli } from './commands/index.js';

const program = createCli();

program.parseAsync().catch((error) => {
  // Handle user interrupts gracefully (Ctrl+C)
  if (error?.name === 'ExitPromptError' || error?.message?.includes('SIGINT')) {
    process.exit(130); // Standard exit code for SIGINT
  }
  // Re-throw other errors
  console.error(error);
  process.exit(1);
});
