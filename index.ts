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
    description: "Select or inspect the active workspace preset; `edit` opens the TUI presets.yml editor",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "edit") {
        if (!ctx.hasUI) {
          ctx.ui.notify("/preset edit 需要交互式 TUI", "warning");
          return;
        }
        const { runPresetDashboard } = await import("./tui/preset-dashboard.ts");
        await runPresetDashboard(ctx, getAgentDir(), { activate: (name) => activate(ctx, name) });
        return;
      }
      const config = loadPresetConfig(getAgentDir());
      const names = Object.keys(config.presets ?? {});
      const value = args.trim() || (await ctx.ui.select("Select preset", ["Base", ...names]));
      if (!value) return;
      if (value.toLowerCase() === "status") {
        ctx.ui.notify(`Preset: ${active ?? "Base"}`, "info");
        return;
      }
      await activate(ctx, value.toLowerCase() === "base" ? null : value);
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