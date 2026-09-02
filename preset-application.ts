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
    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    const unknown = preset.settings.tools.filter((tool) => !available.has(tool));
    if (unknown.length) throw new Error(`Unknown tools: ${unknown.join(", ")}`);
    pi.setActiveTools(preset.settings.tools);
  }
  return previous;
}
