// Type declarations for untyped dependencies

declare module 'phylo' {
  interface PhyloFile {
    path: string;
    name: string;
    exists(): boolean;
    stat(): { isDirectory(): boolean; isFile(): boolean };
    isAbsolute(): boolean;
    absolutify(): PhyloFile;
    absolutePath(): string;
    canonicalize(): PhyloFile;
    canonicalPath(): string;
    relativize(base: string): PhyloFile;
    join(...paths: string[]): PhyloFile;
    up(name: string): PhyloFile | null;
    load(): unknown;
  }

  interface PhyloStatic {
    from(path: string | PhyloFile): PhyloFile;
    cwd(): PhyloFile;
  }

  const File: PhyloStatic;
  export = File;
}

declare module 'deep-assign' {
  function deepAssign<T extends object>(target: T, ...sources: object[]): T;
  export = deepAssign;
}

declare module 'loog' {
  interface LoggerOptions {
    prefixStyle?: 'ascii' | 'unicode';
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  }

  interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    setLogLevel(level: string): void;
  }

  function loog(options?: LoggerOptions): Logger;
  export = loog;
}

declare module 'omelette' {
  interface Omelette {
    tree(tree: Record<string, string[] | null>): Omelette;
    init(): void;
    setupShellInitFile(): void;
  }

  function omelette(name: string): Omelette;
  export = omelette;
}

declare module 'openurl2' {
  function open(url: string): void;
  export { open };
}
