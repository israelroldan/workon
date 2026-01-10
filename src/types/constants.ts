import type { IdeType } from './index.js';

/**
 * IDE choice options for interactive selection prompts.
 * Shared between interactive.ts and manage.ts.
 */
export const IDE_CHOICES = [
  { name: 'Visual Studio Code', value: 'vscode' as IdeType },
  { name: 'Visual Studio Code (code)', value: 'code' as IdeType },
  { name: 'IntelliJ IDEA', value: 'idea' as IdeType },
  { name: 'Atom', value: 'atom' as IdeType },
  { name: 'Sublime Text', value: 'subl' as IdeType },
  { name: 'Vim', value: 'vim' as IdeType },
  { name: 'Emacs', value: 'emacs' as IdeType },
] as const;
