// tui/preset-editor.ts
//
// preset（及 base 段）编辑器：两级导航。
//
//   第一层  技能 / MCP 服务 / 扩展 / 包（enable.*）+ 设置 + 原始 JSON + 保存
//   第二层  资源组 Enter 切换成员；设置 Enter 编辑字段；Ctrl+S 在任意一层保存
//
// 行上只显示中文标签，原始键名（enable.* / settings.* / resources.*）在 ? 帮助浮层里给出。
// settings 提供常用字段 + 原始 JSON 兜底；Ctrl+S 保存整个 presets.yml。

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	isObjectRegistry,
	parseToolsInput,
	registryDefinition,
	removeRegistryEntry,
	RESOURCE_GROUPS,
	resourceIds,
	setRegistryEntry,
	THINKING_LEVELS,
	toggleInList,
	type ResourceGroup,
} from "../preset-mutations.ts";
import { savePresetConfig } from "../preset-loader.ts";
import type { Preset, PresetConfig } from "../types.ts";
import { padLabel, showOptionPicker, showPersistentFormMenu, showPersistentShortcutMenu, type MenuCursor, type MenuRow } from "./persistent-menu.ts";

export const SETTINGS_FIELDS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "tools"] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

/** 设置项的中文标签；原始键名（settings.*）在帮助浮层里给出。 */
const SETTINGS_FIELD_LABELS: Record<SettingsField, string> = {
	defaultProvider: "默认 Provider",
	defaultModel: "默认模型",
	defaultThinkingLevel: "默认思考等级",
	tools: "工具白名单",
};

/** 资源组的中文标签；原始键名（enable.* / resources.*）在帮助浮层里给出。 */
export const GROUP_LABELS: Record<ResourceGroup, string> = {
	skills: "技能",
	mcp: "MCP 服务",
	extensions: "扩展",
	packages: "包",
};

const FIELD_HELP: Record<string, string> = {
	defaultProvider: "本 preset 生效时使用的默认 provider；留空恢复继承 base。",
	defaultModel: "默认模型 ID；留空恢复继承 base。",
	defaultThinkingLevel: "默认思考等级；留空恢复继承 base。",
	tools: "启用的工具白名单（逗号分隔）；留空恢复继承 base。",
};

const NEW_ROW = "＋新建";

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

function describeSettingsSummary(preset: Preset, base?: Preset): string {
	const own = Object.keys(preset.settings ?? {});
	if (own.length > 0) return `${own.length} 项自定义`;
	const inherited = Object.keys(base?.settings ?? {});
	if (inherited.length > 0) return `${inherited.length} 项（继承 base）`;
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
	title: string,
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
		const enabledCount = ids.filter((id) => enabled().includes(id) || inheritedIds.has(id)).length;
		const action = await showPersistentShortcutMenu(
			ctx,
			`${title} › ${GROUP_LABELS[group]}`,
			"",
			rows,
			cursor,
			[],
			{
				getContext: () => `已启用 ${enabledCount} / ${ids.length} 项 · enable.${group}`,
				emptyLabel: `resources.${group} 注册表为空；请先在主面板的 [资源注册表] 里添加`,
				hints: [
					{ key: "↑↓", label: "选择" },
					{ key: "Enter", label: "切换" },
					{ key: "Esc", label: "返回" },
				],
				helpLines: [
					`enable.${group} — 启用哪些资源 ID；[✓] 为已启用。`,
					"合并语义是 base 与 preset 拼接，preset 层无法排除继承项；继承项请到 base 段取消。",
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

/** 设置分节的字段列表：Enter 编辑字段，Ctrl+S 保存，Esc 返回上一层。 */
async function editSettingsSection(
	ctx: ExtensionCommandContext,
	title: string,
	preset: Preset,
	base?: Preset,
): Promise<"back" | "save"> {
	const cursor: MenuCursor = { index: 0 };
	while (true) {
		const rows: MenuRow[] = SETTINGS_FIELDS.map((field) => ({
			id: field,
			label: `${padLabel(SETTINGS_FIELD_LABELS[field], 16)}${describeSetting(preset, field, base)}`,
			searchText: `${field} ${SETTINGS_FIELD_LABELS[field]}`,
		}));
		const action = await showPersistentFormMenu(ctx, `${title} › 设置`, "", rows, cursor, {
			getContext: () => "Ctrl+S 保存 · Esc 返回",
			getDetailLines: (row) => {
				if (!row) return [];
				const help = FIELD_HELP[row.id];
				return help ? [`  settings.${row.id} — ${help}`] : [];
			},
			hints: [
				{ key: "↑↓", label: "选择" },
				{ key: "Enter", label: "编辑" },
				{ key: "Ctrl+S", label: "保存" },
				{ key: "Esc", label: "返回" },
			],
			helpLines: ["（继承）表示未覆盖、当前取自 base 段；preset 同名字段覆盖 base。"],
		});
		if (action.type === "cancel") return "back";
		if (action.type === "save") return "save";
		await editSettingField(ctx, preset, action.id as SettingsField, base);
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
	const persistSafely = (): boolean => {
		try {
			persist();
			return true;
		} catch (error) {
			void ctx.ui.notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	};
	while (true) {
		const rows: MenuRow[] = [
			...RESOURCE_GROUPS.map((group) => ({
				id: `group:${group}`,
				label: `${padLabel(GROUP_LABELS[group], 14)}${describeEnabled(preset, group, config, base)}`,
				searchText: `enable.${group} ${GROUP_LABELS[group]}`,
			})),
			{ id: "settings", label: `${padLabel("设置", 14)}${describeSettingsSummary(preset, base)}`, searchText: "settings 设置" },
			{ id: "settingsRaw", label: `${padLabel("原始 JSON", 14)}编辑全部设置`, searchText: "settings raw 原始 JSON" },
			{ id: "save", label: `${padLabel("保存", 14)}写入 presets.yml`, searchText: "save 保存 presets.yml" },
		];
		const action = await showPersistentFormMenu(ctx, title, "", rows, cursor, {
			getContext: () => (base ? "继承 base 的有效值 · Ctrl+S 保存" : "base 段 · Ctrl+S 保存"),
			getDetailLines: (row) => {
				if (!row) return [];
				if (row.id.startsWith("group:")) {
					const group = row.id.slice("group:".length) as ResourceGroup;
					return [`  enable.${group} — Enter 进入${GROUP_LABELS[group]}成员列表，逐项切换启用状态。`];
				}
				if (row.id === "settings") return ["  settings.* — 包含 defaultProvider / defaultModel / defaultThinkingLevel / tools。"];
				if (row.id === "settingsRaw") return ["  settings — 直接编辑 settings 段的 JSON，保存后整体替换。"];
				if (row.id === "save") return ["  presets.yml — 写入磁盘；写入前做 schema 校验。"];
				return [];
			},
			hints: [
				{ key: "↑↓", label: "选择" },
				{ key: "Enter", label: "进入" },
				{ key: "Ctrl+S", label: "保存" },
				{ key: "Esc", label: "返回" },
			],
			helpLines: base
				? ["enable 以 base 与 preset 的并集生效；settings 中 preset 覆盖 base。", "表单预填合并后的有效值，（继承）表示未覆盖。"]
				: ["base 段是全局基础：所有 preset 都继承它的 enable 与 settings。"],
		});
		if (action.type === "cancel") return false;
		if (action.type === "save" || action.id === "save") {
			if (persistSafely()) return true;
			continue;
		}
		if (action.id === "settingsRaw") {
			await editSettingsRaw(ctx, preset);
			continue;
		}
		if (action.id === "settings") {
			const result = await editSettingsSection(ctx, title, preset, base);
			if (result === "save" && persistSafely()) return true;
			continue;
		}
		if (action.id.startsWith("group:")) {
			await toggleGroup(ctx, title, action.id.slice("group:".length) as ResourceGroup, preset, config, base);
			continue;
		}
	}
}

/** resources 注册表管理器：n 新建、Enter 编辑定义、d 删除；每次动作立即落盘。 */
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
		const rows: MenuRow[] = [
			{ id: NEW_ROW, label: "＋ 新建资源", searchText: "新建 新建资源" },
			...ids.map((id) => ({
				id,
				label: objectMode ? padLabel(id, 24) + "（有定义体）" : id,
				searchText: id,
			})),
		];
		const action = await showPersistentShortcutMenu<"new" | "delete">(
			ctx,
			`资源注册表 › ${GROUP_LABELS[group]}${objectMode ? "（对象注册表）" : "（ID 列表）"}`,
			"",
			rows,
			cursor,
			[{ input: "n", shortcut: "new" }, { input: "d", shortcut: "delete" }],
			{
				getContext: () => `${ids.length} 项 · ${objectMode ? "对象注册表" : "ID 列表"} · resources.${group}`,
				getDetailLines: (row) => {
					if (!row || row.id === NEW_ROW) return [`  resources.${group} — 注册表决定 enable.${group} 里能选哪些 ID。`];
					return objectMode ? [`  定义体：${JSON.stringify(registryDefinition(config, group, row.id))}`] : [];
				},
				emptyLabel: "暂无资源",
				hints: [
					{ key: "↑↓", label: "选择" },
					...(objectMode ? [{ key: "Enter", label: "编辑" }] : []),
					{ key: "n", label: "新建" },
					{ key: "d", label: "删除" },
					{ key: "Esc", label: "返回" },
				],
				helpLines: ["删除 ID 后，引用它的 preset 需要同步调整。"],
			},
		);
		if (action.type === "cancel") return;
		if (action.type === "shortcut" && action.shortcut === "new") {
			const created = await createRegistryEntry(ctx, group, config, agentDir, ids, objectMode);
			if (created) cursor.index = ids.indexOf(created) + 1;
			continue;
		}
		if (action.type === "shortcut" && action.shortcut === "delete") {
			const selected = rows[cursor.index];
			if (!selected || selected.id === NEW_ROW) {
				void ctx.ui.notify("请先选中一个资源再按 d", "info");
				continue;
			}
			if (await ctx.ui.confirm(`删除 resources.${group}.${selected.id}`, "该 ID 将从注册表中移除；引用它的 preset 需要同步调整")) {
				removeRegistryEntry(config, group, selected.id);
				savePresetConfig(agentDir, config);
				cursor.index = Math.max(0, Math.min(cursor.index, resourceIds(config, group).length));
			}
			continue;
		}
		if (action.type !== "pick") continue;
		if (action.id === NEW_ROW) {
			const created = await createRegistryEntry(ctx, group, config, agentDir, ids, objectMode);
			if (created) cursor.index = ids.indexOf(created) + 1;
			continue;
		}
		// Enter：对象注册表打开定义 JSON 编辑器；列表注册表无事可做。
		if (!objectMode) continue;
		const current = registryDefinition(config, group, action.id);
		const text = await ctx.ui.editor(`resources.${group}.${action.id} 定义 JSON`, JSON.stringify(current ?? {}, null, 2));
		if (text === undefined) continue;
		try {
			const parsed: unknown = JSON.parse(text);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				void ctx.ui.notify("定义必须是 JSON 对象，已放弃", "warning");
				continue;
			}
			setRegistryEntry(config, group, action.id, parsed);
			savePresetConfig(agentDir, config);
		} catch (error) {
			void ctx.ui.notify(`JSON 解析失败，已放弃：${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	}
}

async function createRegistryEntry(
	ctx: ExtensionCommandContext,
	group: ResourceGroup,
	config: PresetConfig,
	agentDir: string,
	ids: readonly string[],
	objectMode: boolean,
): Promise<string | undefined> {
	const id = await ctx.ui.input(`新增 ${group} 资源 ID`, "");
	if (id === undefined) return undefined;
	const trimmed = id.trim();
	if (!trimmed) return undefined;
	if (ids.includes(trimmed)) {
		void ctx.ui.notify(`${trimmed} 已存在`, "warning");
		return undefined;
	}
	if (objectMode) {
		const text = await ctx.ui.editor(`resources.${group}.${trimmed} 定义 JSON`, "{}");
		if (text === undefined) return undefined;
		try {
			const parsed: unknown = JSON.parse(text);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				void ctx.ui.notify("定义必须是 JSON 对象，已放弃", "warning");
				return undefined;
			}
			setRegistryEntry(config, group, trimmed, parsed);
		} catch (error) {
			void ctx.ui.notify(`JSON 解析失败，已放弃：${error instanceof Error ? error.message : String(error)}`, "warning");
			return undefined;
		}
	} else {
		setRegistryEntry(config, group, trimmed, undefined);
	}
	savePresetConfig(agentDir, config);
	return trimmed;
}
