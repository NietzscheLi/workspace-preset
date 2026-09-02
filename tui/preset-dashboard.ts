// tui/preset-dashboard.ts
//
// presets.yml 编辑主面板：
//
//   Enter 编辑 / s 切换激活 / n 新建 preset / d 删除 / q 退出
//
// 每次动作前都重新 loadPresetConfig 再改再存（savePresetConfig 做校验 + 原子写入），
// 外部修改不会导致保存失败，最多表现为列表显示稍有滞后（下一轮自动刷新）。

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { loadPresetConfig, savePresetConfig } from "../preset-loader.ts";
import { readProjectPreset } from "../project-selection.ts";
import { RESOURCE_GROUPS, resourceIds, type ResourceGroup } from "../preset-mutations.ts";import { editPreset, editResourceGroup } from "./preset-editor.ts";
import { padLabel, showOptionPicker, showPersistentShortcutMenu, type MenuCursor, type MenuRow } from "./persistent-menu.ts";

export interface PresetDashboardDeps {
	/** 面板内切换激活 preset；复用 /preset 命令的应用逻辑（含 reload）。 */
	activate: (name: string | null) => Promise<void>;
}

interface DashboardRow extends MenuRow {
	id: string;
	label: string;
	searchText?: string;
}

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

		const rows: DashboardRow[] = [
			{
				id: "activate",
				label: padLabel("激活", 24) + `当前：${active ?? "Base"}（Enter/s 切换）`,
			},
			{
				id: "base",
				label: padLabel("base 段", 24) + "全局基础 enable/settings",
			},
			...presetNames.map((name) => ({
				id: `preset:${name}`,
				label: padLabel(name, 24) + (name === active ? "← 已激活" : "preset"),
				searchText: name,
			})),
			...RESOURCE_GROUPS.map((group) => ({
				id: `resources:${group}`,
				label: padLabel(`resources.${group}`, 24) + `${resourceIds(config, group).length} 项注册`,
				searchText: group,
			})),
		];

		const detailLines = (row: DashboardRow | undefined, _theme: Theme): string[] => {
			if (!row) return [];
			if (row.id === "activate") return ["  切换会应用模型/思考等级/工具设置，并同步 preset-mcp.json 与项目 .pi/preset.json"];
			if (row.id === "base") return ["  base 与命名 preset 合并：enable 取并集，settings 中 preset 覆盖 base"];
			if (row.id.startsWith("preset:")) {
				const name = row.id.slice("preset:".length);
				const preset = config.presets?.[name];
				if (!preset) return [];
				return [
					`  enable: ${RESOURCE_GROUPS.map((group) => `${group} ${(preset.enable?.[group] ?? []).length}`).join(" · ")}`,
					`  settings: ${Object.keys(preset.settings ?? {}).join(", ") || "—"}`,
				];
			}
			const group = row.id.slice("resources:".length) as ResourceGroup;
			return [`  ${resourceIds(config, group).join(", ") || "（空注册表）"}`];
		};

		const action = await showPersistentShortcutMenu<"new" | "activate" | "quit" | "delete">(
			ctx,
			"presets.yml",
			"",
			rows,
			cursor,
			[
				{ input: "s", shortcut: "activate" },
				{ input: "n", shortcut: "new" },
				{ input: "d", shortcut: "delete" },
				{ input: "q", shortcut: "quit" },
			],
			{
				getSummaryLines: () => [
					`presets ${presetNames.length} · 激活 ${active ?? "Base"} · version ${config.version}`,
					"激活行切换当前会话 preset；其余行编辑 presets.yml 本体",
				],
				getDetailLines: detailLines,
				emptyLabel: "presets.yml 为空",
				hints: [
					{ key: "↑↓", label: "选择" },
					{ key: "Enter", label: "编辑" },
					{ key: "s", label: "切换激活" },
					{ key: "n", label: "新建 preset" },
					{ key: "d", label: "删除 preset" },
					{ key: "q", label: "退出" },
				],
			},
		);

		if (action.type === "cancel" || (action.type === "shortcut" && action.shortcut === "quit")) return;

		if (action.type === "shortcut" && action.shortcut === "activate") {
			await pickAndActivate(ctx, agentDir, active, deps);
			continue;
		}
		if (action.type === "shortcut" && action.shortcut === "new") {
			const name = await ctx.ui.input("新 preset 名称", "");
			if (name === undefined) continue;
			const trimmed = name.trim();
			if (!trimmed) continue;
			const latest = loadPresetConfig(agentDir);
			if (latest.presets?.[trimmed]) {
				void ctx.ui.notify(`preset ${trimmed} 已存在`, "warning");
				continue;
			}
			latest.presets ??= {};
			latest.presets[trimmed] = {};
			savePresetConfig(agentDir, latest);
			continue;
		}
		if (action.type === "shortcut" && action.shortcut === "delete") {
			const selectedId = rows[cursor.index]?.id ?? "";
			if (!selectedId.startsWith("preset:")) {
				void ctx.ui.notify("请先选中一个 preset 行再按 d", "info");
				continue;
			}
			const name = selectedId.slice("preset:".length);
			if (await ctx.ui.confirm(`删除 preset ${name}`, "只从 presets.yml 移除；项目 .pi/preset.json 如引用它会指向不存在的 preset")) {
				const latest = loadPresetConfig(agentDir);
				delete latest.presets?.[name];
				savePresetConfig(agentDir, latest);
			}
			continue;
		}

		const row = rows.find((candidate) => candidate.id === action.id);
		if (!row) continue;
		if (row.id === "activate") {
			await pickAndActivate(ctx, agentDir, active, deps);
			continue;
		}
		if (row.id === "base") {
			const latest = loadPresetConfig(agentDir);
			const base = latest.base ?? (latest.base = {});
			await editPreset(ctx, "base 段", latest, base, () => savePresetConfig(agentDir, latest));
			continue;
		}
		if (row.id.startsWith("preset:")) {
			const name = row.id.slice("preset:".length);
			const latest = loadPresetConfig(agentDir);
			latest.presets ??= {};
			const preset = latest.presets[name] ?? (latest.presets[name] = {});
			await editPreset(ctx, `preset: ${name}`, latest, preset, () => savePresetConfig(agentDir, latest), latest.base);
			continue;
		}
		if (row.id.startsWith("resources:")) {
			const group = row.id.slice("resources:".length) as ResourceGroup;
			const latest = loadPresetConfig(agentDir);
			await editResourceGroup(ctx, group, latest, agentDir);
			continue;
		}
	}
}