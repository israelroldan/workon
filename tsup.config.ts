import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    external: ['conf', 'omelette', 'phylo', 'simple-git', 'loog'],
  },
  // CLI entry point
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    external: ['conf', 'omelette', 'phylo', 'simple-git', 'loog'],
  },
]);
