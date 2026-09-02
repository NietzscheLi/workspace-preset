export interface Preset {
  enable?: { skills?: string[]; mcp?: string[]; extensions?: string[]; packages?: string[] };
  settings?: Record<string, unknown>;
}
export interface PresetConfig {
  version: number;
  resources?: Record<string, unknown>;
  base?: Preset;
  presets?: Record<string, Preset>;
}
export interface ResolvedPreset {
  name: string | null;
  skills: string[];
  mcp: string[];
  extensions: string[];
  packages: string[];
  settings: Record<string, unknown>;
}
