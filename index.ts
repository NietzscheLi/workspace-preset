import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { applyPreset, type OriginalState } from "./preset-application.ts";
import { ensurePresetConfigFile, loadPresetConfig, resolvePreset } from "./preset-loader.ts";
import { writeMcpSnapshot } from "./mcp-config.ts";
import { readProjectPreset, writeProjectPreset } from "./project-selection.ts";

async function installMcp(agentDir: string, serverIds: string[], pi: ExtensionAPI): Promise<void> {
  const runtimePath = `${agentDir}/preset-runtime/shared.ts`;
  if (!serverIds.length || !existsSync(runtimePath)) return;
  const runtime = await import(runtimePath);
  runtime.installPresetMcp(pi, serverIds);
}

export default function workspacePresetExtension(pi: ExtensionAPI): void {
  let active: string | null = null;
  let original: OriginalState | undefined;

  // 配置缺失时初始化基础 presets.yml；失败不阻断扩展加载（loadPresetConfig 有默认值兑底）。
  try {
    ensurePresetConfigFile(getAgentDir());
  } catch {
    // 初始化失败交由后续读取/保存时报错。
  }

  const refreshStatus = (ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]) => {
    ctx.ui.setStatus("preset", active ? `preset:${active}` : undefined);
  };

  // /preset 与 TUI 面板共用的激活逻辑：应用设置、同步 MCP 快照与项目选择，必要时 reload。
  const activate = async (ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1], name: string | null): Promise<void> => {
    const agentDir = getAgentDir();
    const config = loadPresetConfig(agentDir);
    const target = resolvePreset(config, name);
    const previous = active;
    try {
      original = await applyPreset(pi, ctx, target, original);
      writeMcpSnapshot(agentDir, target, config);
      writeProjectPreset(ctx.cwd, name);
      active = name;
      refreshStatus(ctx);
      if (name !== previous) {
        await ctx.reload();
        return;
      }
      ctx.ui.notify(`Preset activated: ${name ?? "Base"}`, "info");
    } catch (error) {
      writeProjectPreset(ctx.cwd, previous);
      ctx.ui.notify(`Preset switch failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  pi.registerCommand("preset", {
    description: "Activate or inspect a workspace preset; subcommands: status, edit (TUI), help, or a preset name",
    handler: async (args, ctx) => {
      // 子命令风格与 provider-status 对齐：status / edit / help + 领域扩展命令。
      const USAGE = "usage: /preset [status | edit | help | <name>]";
      const raw = args.trim();
      const tokens = raw.split(/\s+/).filter(Boolean);
      const command = (tokens[0] ?? "").toLowerCase();
      if (command === "help") {
        ctx.ui.notify(USAGE, "info");
        return;
      }
      if (command === "status") {
        ctx.ui.notify(`Preset: ${active ?? "Base"}`, "info");
        return;
      }
      if (command === "edit") {
        if (!ctx.hasUI) {
          ctx.ui.notify("/preset edit 需要交互式 TUI", "warning");
          return;
        }
        const { runPresetDashboard } = await import("./tui/preset-dashboard.ts");
        await runPresetDashboard(ctx, getAgentDir(), { activate: (name) => activate(ctx, name) });
        return;
      }
      if (command === "") {
        if (!ctx.hasUI) {
          ctx.ui.notify(`Preset: ${active ?? "Base"}`, "info");
          return;
        }
        const config = loadPresetConfig(getAgentDir());
        const names = Object.keys(config.presets ?? {});
        const value = await ctx.ui.select("Select preset", ["Base", ...names]);
        if (!value) return;
        await activate(ctx, value.toLowerCase() === "base" ? null : value);
        return;
      }
      // 非保留字则按 preset 名称激活（保持与原行为一致）。
      await activate(ctx, command === "base" ? null : raw);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const selected = readProjectPreset(ctx.cwd);
    active = selected;
    const config = loadPresetConfig(getAgentDir());
    const preset = resolvePreset(config, selected);
    writeMcpSnapshot(getAgentDir(), preset, config);
    await installMcp(getAgentDir(), preset.mcp, pi);
    refreshStatus(ctx);
  });
}