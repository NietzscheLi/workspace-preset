import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ResolvedPreset } from "./types.ts";

export interface OriginalState {
  model: Model<Api> | undefined;
  thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>;
  tools: string[];
}

export async function applyPreset(pi: ExtensionAPI, ctx: ExtensionContext, preset: ResolvedPreset, original?: OriginalState): Promise<OriginalState> {
  const previous = original ?? { model: ctx.model, thinkingLevel: pi.getThinkingLevel(), tools: pi.getActiveTools() };
  if (preset.settings.defaultProvider && preset.settings.defaultModel) {
    const model = ctx.modelRegistry.find(String(preset.settings.defaultProvider), String(preset.settings.defaultModel));
    if (!model) throw new Error(`Model not found: ${preset.settings.defaultProvider}/${preset.settings.defaultModel}`);
    if (!(await pi.setModel(model))) throw new Error(`No authentication for: ${preset.settings.defaultProvider}`);
  }
  if (typeof preset.settings.defaultThinkingLevel === "string") pi.setThinkingLevel(preset.settings.defaultThinkingLevel as ReturnType<ExtensionAPI["getThinkingLevel"]>);
  if (preset.settings.tools !== undefined) {
    const tools = preset.settings.tools;
    if (!Array.isArray(tools) || !tools.every((tool): tool is string => typeof tool === "string")) {
      throw new Error("tools must be a string array");
    }
    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    const unknown = tools.filter((tool) => !available.has(tool));
    // 未知工具可能由本次切换启用的 extension/package 在 ctx.reload() 后注册：Pi 的 refreshToolRegistry
    // 会自动并入新注册的工具，因此这里只告警，不阻断激活（否则这类 preset 永远无法激活）。
    if (unknown.length) ctx.ui.notify(`Tools not loaded yet (applied after reload): ${unknown.join(", ")}`, "warning");
    pi.setActiveTools(tools);
  }
  return previous;
}
