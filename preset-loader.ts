import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Preset, PresetConfig, ResolvedPreset } from "./types.ts";
import { validatePresetConfig } from "./preset-schema.ts";

export const PRESETS_FILE_NAME = "presets.json";

function configPath(agentDir: string): string {
	return join(agentDir, PRESETS_FILE_NAME);
}

function readConfig(agentDir: string): PresetConfig {
	const path = configPath(agentDir);
	if (!existsSync(path)) return { version: 1, resources: {}, base: { enable: {}, settings: {} }, presets: {} };
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	validatePresetConfig(value, path);
	return value;
}

function writeConfigAtomic(agentDir: string, config: PresetConfig): void {
	const path = configPath(agentDir);
	const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
	writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	renameSync(temp, path);
}

/** 启动时检测：presets.json 缺失时初始化一份基础配置；已存在时什么都不做。 */
export function ensurePresetConfigFile(agentDir: string): void {
	if (existsSync(configPath(agentDir))) return;
	const base: PresetConfig = { version: 1, resources: {}, base: { enable: {}, settings: {} }, presets: {} };
	validatePresetConfig(base, "initialized presets.json");
	writeConfigAtomic(agentDir, base);
}

/** 校验并原子保存 presets.json。TUI 面板的唯一写入口：写入总是覆盖整个文件。 */
export function savePresetConfig(agentDir: string, config: PresetConfig): void {
	validatePresetConfig(config, configPath(agentDir));
	writeConfigAtomic(agentDir, config);
}

export function loadPresetConfig(agentDir: string): PresetConfig {
	return readConfig(agentDir);
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
	const source: Preset | undefined = name ? config.presets?.[name] : undefined;
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

/**
 * 资源选择是否变化（决定是否需要重载运行时）：只看 skills/mcp/extensions/packages，
 * 忽略模型/思考等级/工具这类会随 transcript 持久化的 settings。
 */
export function hasResourceSelectionChanged(left: ResolvedPreset, right: ResolvedPreset): boolean {
	const normalize = (items: string[]): string => [...new Set(items)].sort().join("\u0000");
	return (["skills", "mcp", "extensions", "packages"] as const).some(
		(group) => normalize(left[group]) !== normalize(right[group]),
	);
}
