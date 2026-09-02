import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify as stringifyYaml } from "yaml";
import type { Preset, PresetConfig, ResolvedPreset } from "./types.ts";
import { validatePresetConfig } from "./preset-schema.ts";

const PRESETS_FILE_HEADER = "# Managed by pi-workspace-preset.\n";

function readYaml(path: string): PresetConfig {
  if (!existsSync(path)) return { version: 1, resources: {}, base: { enable: {}, settings: {} }, presets: {} };
  const value = parse(readFileSync(path, "utf8"));
  validatePresetConfig(value, path);
  return value;
}

function writeYamlAtomic(path: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
}

/**
 * 启动时检测：若 pi 配置目录中缺少 presets.yml，则初始化一份基础配置。
 * 已存在时什么都不做；写入前用 validatePresetConfig 自检，保证初始化产物一定可读。
 */
export function ensurePresetConfigFile(agentDir: string): void {
  const path = join(agentDir, "presets.yml");
  if (existsSync(path)) return;
  const base: PresetConfig = { version: 1, resources: {}, base: { enable: {}, settings: {} }, presets: {} };
  validatePresetConfig(base, "initialized presets.yml");
  writeYamlAtomic(path, PRESETS_FILE_HEADER + stringifyYaml(base, { lineWidth: 0 }));
}

/**
 * 校验并原子保存 presets.yml。TUI 面板的唯一写入口：
 * 每次保存都对完整的配置对象重新校验，但写入总是覆盖整个文件 ——
 * 调用方在每次动作前重新 loadPresetConfig 再改，避免覆盖外部修改。
 */
export function savePresetConfig(agentDir: string, config: PresetConfig): void {
  validatePresetConfig(config, join(agentDir, "presets.yml"));
  writeYamlAtomic(join(agentDir, "presets.yml"), PRESETS_FILE_HEADER + stringifyYaml(config, { lineWidth: 0 }));
}

export function loadPresetConfig(agentDir: string): PresetConfig {
  return readYaml(join(agentDir, "presets.yml"));
}

export function loadProjectSelection(cwd: string): string | null {
  const path = join(cwd, ".pi", "preset.json");
  if (!existsSync(path)) return null;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || typeof (value as { preset?: unknown }).preset !== "string") {
    throw new Error(`${path} must contain an object with a string preset`);
  }
  return (value as { preset: string }).preset;
}

function assertResourceIds(config: PresetConfig, group: "skills" | "mcp" | "extensions" | "packages", ids: string[]): void {
  const registry = config.resources?.[group];
  for (const id of ids) {
    const known = Array.isArray(registry) ? registry.includes(id) : Boolean(registry && typeof registry === "object" && id in registry);
    if (!known) throw new Error(`Unknown ${group} resource: ${id}`);
  }
}

export function resolvePreset(config: PresetConfig, name: string | null): ResolvedPreset {
  const source: Preset = name ? config.presets?.[name] : undefined;
  if (name && !source) throw new Error(`Unknown preset: ${name}`);
  const base = config.base ?? {};
  const enable = source?.enable ?? {};
  const resolved: ResolvedPreset = {
    name: name ?? null,
    skills: [...(base.enable?.skills ?? []), ...(enable.skills ?? [])],
    mcp: [...(base.enable?.mcp ?? []), ...(enable.mcp ?? [])],
    extensions: [...(base.enable?.extensions ?? []), ...(enable.extensions ?? [])],
    packages: [...(base.enable?.packages ?? []), ...(enable.packages ?? [])],
    settings: { ...(base.settings ?? {}), ...(source?.settings ?? {}) },
  };
  for (const group of ["skills", "mcp", "extensions", "packages"] as const) assertResourceIds(config, group, resolved[group]);
  return resolved;
}
