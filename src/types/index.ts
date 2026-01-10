// Project configuration types

export type IdeType = 'vscode' | 'idea' | 'atom' | 'code' | 'subl' | 'vim' | 'emacs' | 'cursor';

export interface ClaudeConfig {
  flags?: string[];
  split_terminal?: boolean;
}

export interface NpmConfig {
  command: string;
  watch?: boolean;
  auto_restart?: boolean;
}

export interface DockerConfig {
  compose_file: string;
  services?: string[];
}

export interface EventsConfig {
  cwd?: boolean;
  ide?: boolean;
  web?: boolean;
  claude?: boolean | ClaudeConfig;
  npm?: boolean | string | NpmConfig;
  docker?: boolean | string | DockerConfig;
  [key: string]: boolean | string | ClaudeConfig | NpmConfig | DockerConfig | undefined;
}

export interface ProjectConfig {
  name?: string;
  path: string;
  ide?: IdeType;
  homepage?: string;
  events: EventsConfig;
  branch?: string;
}

export interface ProjectDefaults {
  base: string;
  ide?: IdeType;
  events?: EventsConfig;
}

export interface AppConfig {
  project_defaults: ProjectDefaults;
  projects: Record<string, ProjectConfig>;
}

// Event system types

export interface EventMetadata {
  name: string;
  displayName: string;
  description: string;
  category: 'core' | 'development' | 'extension';
  requiresTmux: boolean;
  dependencies: string[];
}

export interface EventProcessingContext {
  project: Project;
  isShellMode: boolean;
  shellCommands: string[];
}

export interface EventValidation {
  validateConfig(config: unknown): true | string;
}

export interface EventConfiguration {
  configureInteractive(): Promise<unknown>;
  getDefaultConfig(): unknown;
}

export interface EventProcessing {
  processEvent(context: EventProcessingContext): Promise<void>;
  generateShellCommand(context: EventProcessingContext): string[];
}

export interface EventTmux {
  getLayoutPriority(): number;
  contributeToLayout?(enabledCommands: string[]): string;
}

export interface EventHelp {
  usage: string;
  description: string;
  examples: Array<{ config: unknown; description: string }>;
}

export interface EventHandler {
  metadata: EventMetadata;
  validation: EventValidation;
  configuration: EventConfiguration;
  processing: EventProcessing;
  tmux?: EventTmux | null;
  help: EventHelp;
}

/**
 * Type representing an event class with static properties.
 * This is the shape of the class constructor itself (not an instance).
 * Used when storing event classes in the registry.
 */
export interface EventHandlerClass {
  readonly metadata: EventMetadata;
  readonly validation: EventValidation;
  readonly configuration: EventConfiguration;
  readonly processing: EventProcessing;
  readonly tmux?: EventTmux | null;
  readonly help: EventHelp;
}

// Project class type (for use before implementation)
export interface Project {
  name: string;
  path: { path: string; absolutePath(): string };
  ide?: IdeType;
  homepage?: string;
  events: EventsConfig;
  branch?: string;
  base?: { path: string };
}

// Environment types

export interface BaseEnvironment {
  $isProjectEnvironment: false;
}

export interface ProjectEnvironment {
  $isProjectEnvironment: true;
  project: Project;
}

export type Environment = BaseEnvironment | ProjectEnvironment;

// Logger interface
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setLogLevel(level: string): void;
}

// CLI types
export interface GlobalOptions {
  debug?: boolean;
  shell?: boolean;
}

export interface OpenOptions extends GlobalOptions {
  dryRun?: boolean;
}
