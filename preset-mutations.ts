// preset-mutations.ts
//
// presets.json TUI 编辑的纯逻辑层：资源组注册表读取、enable 开关、settings 字段解析。
// 脱离 TUI 可单测；写盘统一走 preset-loader.ts 的 savePresetConfig。

import type { PresetConfig } from "./types.ts";

export const RESOURCE_GROUPS = ["skills", "mcp", "extensions", "packages"] as const;
export type ResourceGroup = (typeof RESOURCE_GROUPS)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** 注册表可能是 id 数组，也可能是 id -> 定义对象；统一返回 id 列表（保持声明顺序）。 */
export function resourceIds(config: PresetConfig, group: ResourceGroup): string[] {
  const registry = config.resources?.[group];
  if (Array.isArray(registry)) return registry.filter((entry): entry is string => typeof entry === "string");
  if (registry && typeof registry === "object") return Object.keys(registry);
  return [];
}

/** 注册表是否为对象形态（有可编辑的定义体）。 */
export function isObjectRegistry(config: PresetConfig, group: ResourceGroup): boolean {
  const registry = config.resources?.[group];
  return registry !== undefined && !Array.isArray(registry) && typeof registry === "object" && registry !== null;
}

export function registryDefinition(config: PresetConfig, group: ResourceGroup, id: string): unknown {
  const registry = config.resources?.[group];
  if (registry && typeof registry === "object" && !Array.isArray(registry)) {
    return (registry as Record<string, unknown>)[id];
  }
  return undefined;
}

/** 切换 enable 列表中的成员资格；返回新数组。 */
export function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/** tools 设置的输入解析：逗号/空白分隔；空输入返回空数组。 */
export function parseToolsInput(text: string): string[] {
  return text.split(/[,\s]+/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** 注册表写入：对象形态写入定义体，数组/缺失形态追加 id。 */
export function setRegistryEntry(config: PresetConfig, group: ResourceGroup, id: string, definition: unknown): void {
  const resources = config.resources ?? (config.resources = {});
  const existing = resources[group];
  if (existing === undefined || Array.isArray(existing)) {
    const list = Array.isArray(existing) ? existing.filter((entry): entry is string => typeof entry === "string") : [];
    if (!list.includes(id)) list.push(id);
    resources[group] = list;
    return;
  }
  if (typeof existing === "object") {
    (existing as Record<string, unknown>)[id] = definition ?? {};
  }
}

export function removeRegistryEntry(config: PresetConfig, group: ResourceGroup, id: string): void {
  const registry = config.resources?.[group];
  if (Array.isArray(registry)) {
    config.resources![group] = registry.filter((entry) => entry !== id);
  } else if (registry && typeof registry === "object") {
    delete (registry as Record<string, unknown>)[id];
  }
}