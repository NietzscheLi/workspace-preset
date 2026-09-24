import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { applyPreset, type OriginalState } from "./preset-application.ts";
import { ensurePresetConfigFile, hasResourceSelectionChanged, loadPresetConfig, resolvePreset } from "./preset-loader.ts";
import type { PresetConfig, ResolvedPreset } from "./types.ts";
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
  // 上次激活时 presets.json 的签名：预设定义（含 MCP 定义体）变化时保守重载。
  let lastAppliedConfigSignature: string | undefined;

  // 配置缺失时初始化基础 presets.json；失败不阻断扩展加载。
  try {
    ensurePresetConfigFile(getAgentDir());
  } catch {
    // 初始化失败交由后续读取/保存时报错。
  }

  const refreshStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus("preset", active ? `preset:${active}` : undefined);
  };

  /**
   * 资源集合（skills/mcp/extensions/packages）是否变化；旧 preset 已删除/无法解析时保守视为变化。
   */
  const resourceSelectionChanged = (config: PresetConfig, previous: string | null, target: ResolvedPreset): boolean => {
    try {
      return hasResourceSelectionChanged(resolvePreset(config, previous), target);
    } catch {
      // 旧 preset 已删除/无法解析：保守重载。
      return true;
    }
  };

  // /preset 与 TUI 面板共用的激活逻辑：应用设置、同步 MCP 快照与项目选择，必要时 reload。
  const activate = async (ctx: ExtensionCommandContext, name: string | null): Promise<void> => {
    const agentDir = getAgentDir();
    const config = loadPresetConfig(agentDir);
    const configSignature = JSON.stringify(config);
    const target = resolvePreset(config, name);
    const previous = active;
    try {
      original = await applyPreset(pi, ctx, target, original);
      writeMcpSnapshot(agentDir, target, config);
      writeProjectPreset(ctx.cwd, name);
      active = name;
      refreshStatus(ctx);
      // presets.json 内容变化（含 MCP 定义体）或资源集合变化都需要重载；只改 settings 时走轻量路径，
      // 因为 pi 0.86.0 起会把模型/思考等级/工具的变更写入 transcript 并在 resume/branch 后保持。
      const signatureChanged = lastAppliedConfigSignature !== configSignature;
      const resourcesChanged = name !== previous && resourceSelectionChanged(config, previous, target);
      lastAppliedConfigSignature = configSignature;
      if (signatureChanged || resourcesChanged) {
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
    description: "Activate or inspect a workspace preset; subcommands: status, config (TUI), help, or a preset name",
    handler: async (args, ctx) => {
      // 子命令风格与 provider-status 对齐：status / config / help + 领域扩展命令。
      const USAGE = "usage: /preset [status | config | help | <name>]";
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
      if (command === "config" || command === "edit") {
        if (!ctx.hasUI) {
          ctx.ui.notify(`/preset ${command} 需要交互式 TUI`, "warning");
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
    // 会话启动已按项目记录安装资源：把当前 presets.json 记为基线，
    // 使启动后首次激活同一 preset 不再多一次 ctx.reload()。
    lastAppliedConfigSignature = JSON.stringify(config);
    const preset = resolvePreset(config, selected);
    writeMcpSnapshot(getAgentDir(), preset, config);
    await installMcp(getAgentDir(), preset.mcp, pi);
    refreshStatus(ctx);
  });
}