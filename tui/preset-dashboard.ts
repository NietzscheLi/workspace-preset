// tui/preset-dashboard.ts
//
// presets.yml 编辑主面板：两级导航。
//
//   主面板  激活 / presets / base 段 / resources / 退出
//   分类页  presets：＋新建 + 列表（Enter 编辑，s 激活，d 删除）
//           resources：4 个资源组，Enter 进入注册表管理
//
// 每次动作前都重新 loadPresetConfig 再改再存（savePresetConfig 做校验 + 原子写入），
// 外部修改不会导致保存失败，最多表现为列表显示稍有滞后（下一轮自动刷新）。

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadPresetConfig, savePresetConfig } from "../preset-loader.ts";
import { readProjectPreset } from "../project-selection.ts";
import { RESOURCE_GROUPS, resourceIds, type ResourceGroup } from "../preset-mutations.ts";
import { editPreset, editResourceGroup } from "./preset-editor.ts";
import { padLabel, showOptionPicker, showPersistentShortcutMenu, type MenuCursor, type MenuRow } from "./persistent-menu.ts";

export interface PresetDashboardDeps {
	/** 面板内切换激活 preset；复用 /preset 命令的应用逻辑（含 reload）。 */
	activate: (name: string | null) => Promise<void>;
}

const NEW_ROW = "＋新建";

async function pickAndActivate(
	ctx: ExtensionCommandContext,
	agentDir: string,
	current: string | null,
	deps: PresetDashboardDeps,
): Promise<void> {
	const latest = loadPresetConfig(agentDir);
	const names = Object.keys(latest.presets ?? {}).sort();
	const choice = await showOptionPicker(ctx, "切换激活 preset", [
		{ id: "Base", label: "Base（不启用命名 preset）" },
		...names.map((name) => ({ id: name, label: name })),
	], current ?? "Base");
	if (!choice) return;
	await deps.activate(choice.id === "Base" ? null : choice.id);
}

function totalResources(config: ReturnType<typeof loadPresetConfig>): number {
	return RESOURCE_GROUPS.reduce((sum, group) => sum + resourceIds(config, group).length, 0);
}

export async function runPresetDashboard(
	ctx: ExtensionCommandContext,
	agentDir: string,
	deps: PresetDashboardDeps,
): Promise<void> {
	const cursor: MenuCursor = { index: 0 };
	while (true) {
		// 每轮重读磁盘：外部修改不会让面板基于旧状态做写入。
		const config = loadPresetConfig(agentDir);
		const active = readProjectPreset(ctx.cwd);
		const presetNames = Object.keys(config.presets ?? {}).sort();

		const rows: MenuRow[] = [
			{ id: "activate", label: `${padLabel("激活", 14)}当前：${active ?? "Base"}`, searchText: "激活 activate" },
			{ id: "presets", label: `${padLabel("presets", 14)}${presetNames.length} 个`, searchText: "presets" },
			{ id: "base", label: `${padLabel("base 段", 14)}全局基础 enable/settings`, searchText: "base" },
			{ id: "resources", label: `${padLabel("resources", 14)}${totalResources(config)} 项注册`, searchText: "resources" },
			{ id: "quit", label: "退出" },
		];

		const action = await showPersistentShortcutMenu<"quit">(
			ctx,
			"presets.yml",
			"",
			rows,
			cursor,
			[{ input: "q", shortcut: "quit" }],
			{
				getContext: () => `激活 ${active ?? "Base"} · version ${config.version}`,
				getDetailLines: (row) => {
					switch (row?.id) {
						case "activate": return ["  切换会应用模型/思考等级/工具设置，并同步 preset-mcp.json 与项目 .pi/preset.json"];
						case "presets": return ["  命名 preset 列表：编辑 enable/settings，可激活或删除"];
						case "base": return ["  base 与命名 preset 合并：enable 取并集，settings 中 preset 覆盖 base"];
						case "resources": return ["  各资源组的已注册 ID；preset 的 enable 只能从这里选择"];
						default: return [];
					}
				},
				hints: [
					{ key: "↑↓", label: "选择" },
					{ key: "Enter", label: "进入" },
					{ key: "q", label: "退出" },
				],
				helpLines: [
					"presets.yml 分三段：resources 注册可用资源，base 是全局基础，presets 是命名配置。",
					"激活 preset 会写入当前项目的 .pi/preset.json。",
				],
			},
		);

		if (action.type === "cancel" || (action.type === "shortcut" && action.shortcut === "quit")) return;
		if (action.type !== "pick") return;

		if (action.id === "activate") {
			await pickAndActivate(ctx, agentDir, active, deps);
			continue;
		}
		if (action.id === "presets") {
			await openPresets(ctx, agentDir, active, deps);
			continue;
		}
		if (action.id === "base") {
			const latest = loadPresetConfig(agentDir);
			await editPreset(ctx, "base 段", latest, latest.base ?? (latest.base = {}), () => savePresetConfig(agentDir, latest));
			continue;
		}
		if (action.id === "resources") {
			await openResources(ctx, agentDir);
			continue;
		}
	}
}

async function openPresets(
	ctx: ExtensionCommandContext,
	agentDir: string,
	active: string | null,
	deps: PresetDashboardDeps,
): Promise<void> {
	const cursor: MenuCursor = { index: 0 };
	while (true) {
		const config = loadPresetConfig(agentDir);
		const names = Object.keys(config.presets ?? {}).sort();
		const rows: MenuRow[] = [
			{ id: NEW_ROW, label: "＋ 新建 preset", searchText: "新建 新建preset" },
			...names.map((name) => ({
				id: name,
				label: `${padLabel(name, 24)}${name === active ? "← 已激活" : "preset"}`,
				searchText: name,
			})),
		];
		const action = await showPersistentShortcutMenu<"new" | "activate" | "delete">(
			ctx,
			"presets",
			"",
			rows,
			cursor,
			[
				{ input: "n", shortcut: "new" },
				{ input: "s", shortcut: "activate" },
				{ input: "d", shortcut: "delete" },
			],
			{
				getContext: () => `${names.length} 个 preset · 当前 ${active ?? "Base"}`,
				getDetailLines: (row) => {
					if (!row || row.id === NEW_ROW) return ["  新建后进入编辑器配置 enable 与 settings。"];
					const preset = config.presets?.[row.id];
					if (!preset) return [];
					return [
						`  enable: ${RESOURCE_GROUPS.map((group) => `${group} ${(preset.enable?.[group] ?? []).length}`).join(" · ")}`,
						`  settings: ${Object.keys(preset.settings ?? {}).join(", ") || "—"}`,
					];
				},
				emptyLabel: "还没有命名 preset，按 n 新建",
				hints: [
					{ key: "↑↓", label: "选择" },
					{ key: "Enter", label: "编辑" },
					{ key: "n", label: "新建" },
					{ key: "s", label: "激活" },
					{ key: "d", label: "删除" },
					{ key: "Esc", label: "返回" },
				],
				helpLines: ["删除只从 presets.yml 移除；项目 .pi/preset.json 如引用它会指向不存在的 preset。"],
			},
		);
		if (action.type === "cancel") return;
		if (action.type === "shortcut" && action.shortcut === "new") {
			await createPreset(ctx, agentDir);
			continue;
		}
		if (action.type === "shortcut" && action.shortcut === "activate") {
			const selected = rows[cursor.index];
			if (!selected || selected.id === NEW_ROW) {
				void ctx.ui.notify("请先选中一个 preset 再按 s", "info");
				continue;
			}
			await deps.activate(selected.id);
			continue;
		}
		if (action.type === "shortcut" && action.shortcut === "delete") {
			const selected = rows[cursor.index];
			if (!selected || selected.id === NEW_ROW) {
				void ctx.ui.notify("请先选中一个 preset 再按 d", "info");
				continue;
			}
			if (await ctx.ui.confirm(`删除 preset ${selected.id}`, "只从 presets.yml 移除；项目 .pi/preset.json 如引用它会指向不存在的 preset")) {
				const latest = loadPresetConfig(agentDir);
				delete latest.presets?.[selected.id];
				savePresetConfig(agentDir, latest);
			}
			continue;
		}
		if (action.type !== "pick") continue;
		if (action.id === NEW_ROW) {
			await createPreset(ctx, agentDir);
			continue;
		}
		const latest = loadPresetConfig(agentDir);
		latest.presets ??= {};
		const preset = latest.presets[action.id] ?? (latest.presets[action.id] = {});
		await editPreset(ctx, `preset: ${action.id}`, latest, preset, () => savePresetConfig(agentDir, latest), latest.base);
	}
}

async function createPreset(ctx: ExtensionCommandContext, agentDir: string): Promise<void> {
	const name = await ctx.ui.input("新 preset 名称", "");
	if (name === undefined) return;
	const trimmed = name.trim();
	if (!trimmed) return;
	const latest = loadPresetConfig(agentDir);
	if (latest.presets?.[trimmed]) {
		void ctx.ui.notify(`preset ${trimmed} 已存在`, "warning");
		return;
	}
	latest.presets ??= {};
	latest.presets[trimmed] = {};
	savePresetConfig(agentDir, latest);
}

async function openResources(ctx: ExtensionCommandContext, agentDir: string): Promise<void> {
	const cursor: MenuCursor = { index: 0 };
	while (true) {
		const config = loadPresetConfig(agentDir);
		const rows: MenuRow[] = RESOURCE_GROUPS.map((group) => ({
			id: group,
			label: `${padLabel(`resources.${group}`, 24)}${resourceIds(config, group).length} 项注册`,
			searchText: group,
		}));
		const action = await showPersistentShortcutMenu(
			ctx,
			"resources 注册表",
			"",
			rows,
			cursor,
			[],
			{
				getContext: () => `${totalResources(config)} 项已注册`,
				getDetailLines: (row) => {
					const group = row?.id as ResourceGroup | undefined;
					if (!group) return [];
					const ids = resourceIds(config, group);
					return [`  ${ids.join(", ") || "（空注册表）"}`];
				},
				hints: [
					{ key: "↑↓", label: "选择" },
					{ key: "Enter", label: "进入" },
					{ key: "Esc", label: "返回" },
				],
				helpLines: ["preset 的 enable.<group> 只能从对应注册表里选择 ID。", "对象注册表（如 mcp）的每个 ID 还有一份定义体。"],
			},
		);
		if (action.type === "cancel") return;
		if (action.type !== "pick") continue;
		await editResourceGroup(ctx, action.id as ResourceGroup, loadPresetConfig(agentDir), agentDir);
	}
}
