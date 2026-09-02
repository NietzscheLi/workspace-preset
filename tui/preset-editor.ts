// tui/preset-editor.ts
//
// preset（及 base 段）编辑表单：enable 资源组用多选切换菜单，
// settings 提供常用字段 + 原始 JSON 兑底；Ctrl+S 保存整个 presets.yml。

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  isObjectRegistry,
  parseToolsInput,
  registryDefinition,
  resourceIds,
  THINKING_LEVELS,
  toggleInList,
} from "../preset-mutations.ts";
import { savePresetConfig } from "../preset-loader.ts";
import type { Preset, PresetConfig, ResourceGroup } from "../types.ts";
import { padLabel, showOptionPicker, showPersistentFormMenu, showPersistentShortcutMenu, type MenuCursor } from "./persistent-menu.ts";

export const SETTINGS_FIELDS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "tools"] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

function describeEnabled(preset: Preset, group: ResourceGroup, config: PresetConfig, base?: Preset): string {
  const own = preset.enable?.[group] ?? [];
  // 运行时合并语义是拼接（base 在前）；展示用去重后的并集。
  const inherited = (base?.enable?.[group] ?? []).filter((id) => !own.includes(id));
  const total = [...inherited, ...own];
  if (total.length === 0) return "<无>";
  const known = resourceIds(config, group);
  const unknown = total.filter((id) => !known.includes(id));
  const suffix = unknown.length > 0 ? `（${unknown.length} 个未注册）` : "";
  if (own.length === 0) return `${total.length} 项（继承）${suffix}`;
  if (inherited.length === 0) return `${total.length} 项${suffix}`;
  return `${total.length} 项（自身 ${own.length} + 继承 ${inherited.length}）${suffix}`;
}

function formatSettingValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "<空数组>";
  return String(value);
}

function describeSetting(preset: Preset, field: SettingsField, base?: Preset): string {
  const own = preset.settings?.[field];
  if (own !== undefined) return formatSettingValue(own);
  const inherited = base?.settings?.[field];
  if (inherited !== undefined) return `${formatSettingValue(inherited)}（继承）`;
  return "<未设置>";
}

/** 字段的有效值：preset 自身设置优先，否则回退到 base 段继承。 */
function effectiveSetting(preset: Preset, base: Preset | undefined, field: SettingsField): unknown {
  const own = preset.settings?.[field];
  if (own !== undefined) return own;
  return base?.settings?.[field];
}

/** enable 资源组多选：Enter 切换 membership，Esc 返回表单。 */
async function toggleGroup(
  ctx: ExtensionCommandContext,
  group: ResourceGroup,
  preset: Preset,
  config: PresetConfig,
  base?: Preset,
): Promise<void> {
  const cursor: MenuCursor = { index: 0 };
  const enabled = (): string[] => preset.enable?.[group] ?? [];
  const inheritedIds = new Set((base?.enable?.[group] ?? []).filter((id) => !enabled().includes(id)));
  while (true) {
    const known = resourceIds(config, group);
    // 已启用（含继承）但未注册的 id 也列出来，否则用户无法处理它们。
    const ids = [...new Set([...known, ...enabled(), ...inheritedIds])];
    const rows = ids.map((id) => ({
      id,
      label: `${enabled().includes(id) || inheritedIds.has(id) ? "[✓]" : "[ ]"} ${id}${!enabled().includes(id) && inheritedIds.has(id) ? "（继承）" : ""}`,
      searchText: id,
    }));
    const action = await showPersistentShortcutMenu(
      ctx,
      `${group}（Enter 切换启用，${ids.filter((id) => enabled().includes(id) || inheritedIds.has(id)).length} 项已启用）`,
      "",
      rows,
      cursor,
      [],
      {
        emptyLabel: `resources.${group} 注册表为空；请在主面板的 resources 里添加`,
        hints: [
          { key: "↑↓", label: "选择" },
          { key: "Enter", label: "切换" },
          { key: "Esc", label: "返回" },
        ],
      },
    );
    if (action.type === "cancel") return;
    if (action.type !== "pick") continue;
    if (inheritedIds.has(action.id)) {
      // 合并语义是拼接，preset 层无法表达“排除继承项”；引导去 base 段取消。
      void ctx.ui.notify(`${action.id} 继承自 base 段；请在主面板的 base 段中取消启用`, "warning");
      continue;
    }
    preset.enable ??= {};
    preset.enable[group] = toggleInList(enabled(), action.id);
    cursor.index = ids.indexOf(action.id);
  }
}

async function editSettingField(
  ctx: ExtensionCommandContext,
  preset: Preset,
  field: SettingsField,
  base?: Preset,
): Promise<void> {
  preset.settings ??= {};
  if (field === "defaultThinkingLevel") {
    const current = effectiveSetting(preset, base, field);
    const choice = await showOptionPicker(ctx, "默认思考等级", [
      { id: "", label: base?.settings?.[field] !== undefined ? "<恢复继承>" : "<清除设置>" },
      ...THINKING_LEVELS.map((level) => ({ id: level, label: level })),
    ], typeof current === "string" ? current : "");
    if (!choice) return;
    if (choice.id === "") delete preset.settings[field];
    else preset.settings[field] = choice.id;
    return;
  }
  if (field === "tools") {
    const own = preset.settings.tools;
    const current = effectiveSetting(preset, base, field);
    const text = Array.isArray(current) ? current.map(String).join(", ") : "";
    const value = await ctx.ui.input(`tools（当前：${describeSetting(preset, field, base)}；逗号分隔，留空${base?.settings?.tools !== undefined ? "恢复继承" : "清除"}）`, text);
    if (value === undefined) return;
    const parsed = parseToolsInput(value);
    if (parsed.length > 0) {
      // 确认后与继承值完全一致则不落为自身覆盖，保持继承。
      const baseTools = base?.settings?.tools;
      if (own === undefined && Array.isArray(baseTools) && JSON.stringify(parsed) === JSON.stringify(baseTools.map(String))) return;
      preset.settings.tools = parsed;
    } else delete preset.settings.tools;
    return;
  }
  const own = preset.settings[field];
  const current = effectiveSetting(preset, base, field);
  const value = await ctx.ui.input(`${field}（当前：${describeSetting(preset, field, base)}，留空${base?.settings?.[field] !== undefined ? "恢复继承" : "清除"}）`, typeof current === "string" ? current : "");
  if (value === undefined) return;
  const trimmed = value.trim();
  if (trimmed) {
    if (own === undefined && trimmed === base?.settings?.[field]) return;
    preset.settings[field] = trimmed;
  } else delete preset.settings[field];
}

async function editSettingsRaw(ctx: ExtensionCommandContext, preset: Preset): Promise<void> {
  const text = await ctx.ui.editor("settings 原始 JSON（对象）", JSON.stringify(preset.settings ?? {}, null, 2));
  if (text === undefined) return;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      void ctx.ui.notify("settings 必须是 JSON 对象，已放弃", "warning");
      return;
    }
    preset.settings = parsed as Record<string, unknown>;
  } catch (error) {
    void ctx.ui.notify(`JSON 解析失败，已放弃：${error instanceof Error ? error.message : String(error)}`, "warning");
  }
}

/**
 * 编辑一个 preset（或 base 段）。直接修改传入的 preset 引用；
 * Ctrl+S 时调用 onPersist 落盘（抛错时提示且不退出编辑）。
 * 编辑命名 preset 时传入 base（presets.yml 的 base 段），表单预填继承后的有效值；
 * 编辑 base 段自身时不传。
 */
export async function editPreset(
  ctx: ExtensionCommandContext,
  title: string,
  config: PresetConfig,
  preset: Preset,
  persist: () => void,
  base?: Preset,
): Promise<boolean> {
  const cursor: MenuCursor = { index: 0 };
  while (true) {
    const rows = [
      ...(["skills", "mcp", "extensions", "packages"] as const).map((group) => ({
        id: `group:${group}`,
        label: `${padLabel(`enable.${group}`, 24)}${describeEnabled(preset, group, config, base)}`,
      })),
      ...SETTINGS_FIELDS.map((field) => ({
        id: `settings:${field}`,
        label: padLabel(field, 24) + describeSetting(preset, field, base),
      })),
      { id: "settingsRaw", label: padLabel("settings 原始 JSON", 24) + "编辑全部设置" },
    ];
    const action = await showPersistentFormMenu(ctx, title, "", rows, cursor, {
      getSummaryLines: () => [
        `enable 共 ${["skills", "mcp", "extensions", "packages"].map((g) => new Set([...(base?.enable?.[g as ResourceGroup] ?? []), ...(preset.enable?.[g as ResourceGroup] ?? [])]).size).join("/")} 项（skills/mcp/extensions/packages，含继承）`,
        base ? "表单预填 base 合并后的有效值，（继承）表示未覆盖；preset 同名字段覆盖 base" : "enable 只能在 resources 注册表中选择；settings 提供 defaultProvider/defaultModel/defaultThinkingLevel/tools",
      ],
      hints: [
        { key: "↑↓", label: "选择" },
        { key: "Enter", label: "编辑" },
        { key: "Ctrl+S", label: "保存" },
        { key: "Esc", label: "返回" },
      ],
    });
    if (action.type === "cancel") return false;
    if (action.type === "save") {
      try {
        persist();
        return true;
      } catch (error) {
        void ctx.ui.notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
        continue;
      }
    }
    if (action.id === "settings:raw") {
      await editSettingsRaw(ctx, preset);
      continue;
    }
    const [kind, value] = action.id.split(":");
    if (kind === "group") await toggleGroup(ctx, value as ResourceGroup, preset, config, base);
    else if (kind === "field") await editSettingField(ctx, preset, value as SettingsField, base);
  }
}

/** resources 注册表管理器：n 新增、Enter/e 编辑定义、d 删除；每次动作立即落盘。 */
export async function editResourceGroup(
  ctx: ExtensionCommandContext,
  group: ResourceGroup,
  config: PresetConfig,
  agentDir: string,
): Promise<void> {
  const cursor: MenuCursor = { index: 0 };
  while (true) {
    const ids = resourceIds(config, group);
    const objectMode = isObjectRegistry(config, group);
    const rows = ids.map((id) => ({
      id,
      label: objectMode ? padLabel(id, 24) + "（有定义体）" : id,
      searchText: id,
    }));
    const action = await showPersistentShortcutMenu<"new">(
      ctx,
      `resources.${group}${objectMode ? "（对象注册表）" : "（ID 列表）"}`,
      "",
      rows,
      cursor,
      [{ input: "n", shortcut: "new" }],
      {
        emptyLabel: "暂无资源",
        hints: [
          { key: "↑↓", label: "选择" },
          { key: objectMode ? "Enter" : "↑↓", label: objectMode ? "编辑定义" : "浏览" },
          { key: "n", label: "新增" },
          { key: "d", label: "删除" },
          { key: "Esc", label: "返回" },
        ],
      },
    );
    if (action.type === "cancel") return;
    if (action.type === "shortcut" && action.shortcut === "new") {
      const id = await ctx.ui.input(`新增 ${group} 资源 ID`, "");
      if (id === undefined) continue;
      const trimmed = id.trim();
      if (!trimmed) continue;
      if (ids.includes(trimmed)) {
        void ctx.ui.notify(`${trimmed} 已存在`, "warning");
        continue;
      }
      if (objectMode) {
        const text = await ctx.ui.editor(`resources.${group}.${trimmed} 定义 JSON`, "{}");
        if (text === undefined) continue;
        try {
          const parsed: unknown = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            void ctx.ui.notify("定义必须是 JSON 对象，已放弃", "warning");
            continue;
          }
          setRegistryEntry(config, group, trimmed, parsed);
        } catch (error) {
          void ctx.ui.notify(`JSON 解析失败，已放弃：${error instanceof Error ? error.message : String(error)}`, "warning");
          continue;
        }
      } else {
        setRegistryEntry(config, group, trimmed, undefined);
      }
      savePresetConfig(agentDir, config);
      cursor.index = ids.indexOf(trimmed);
      continue;
    }
    const id = action.id;
    if (action.type === "shortcut" && action.shortcut === "delete") {
      if (await ctx.ui.confirm(`删除 resources.${group}.${id}`, "该 ID 将从注册表中移除；引用它的 preset 需要同步调整")) {
        removeRegistryEntry(config, group, id);
        savePresetConfig(agentDir, config);
        cursor.index = Math.max(0, Math.min(cursor.index, ids.length - 2));
      }
      continue;
    }
    // Enter：对象注册表打开定义 JSON 编辑器；列表注册表无事可做。
    if (action.type === "pick" && objectMode) {
      const current = registryDefinition(config, group, id);
      const text = await ctx.ui.editor(`resources.${group}.${id} 定义 JSON`, JSON.stringify(current ?? {}, null, 2));
      if (text === undefined) continue;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          void ctx.ui.notify("定义必须是 JSON 对象，已放弃", "warning");
          continue;
        }
        setRegistryEntry(config, group, id, parsed);
        savePresetConfig(agentDir, config);
      } catch (error) {
        void ctx.ui.notify(`JSON 解析失败，已放弃：${error instanceof Error ? error.message : String(error)}`, "warning");
      }
      continue;
    }
  }
}