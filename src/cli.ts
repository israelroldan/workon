#!/usr/bin/env node
import { createCli } from './commands/index.js';

const program = createCli();
program.parse();
