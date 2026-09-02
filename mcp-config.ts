import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PresetConfig, ResolvedPreset } from "./types.ts";

export interface McpSnapshot { version: 1; preset: string | null; serverIds: string[]; }

export function writeMcpSnapshot(agentDir: string, preset: ResolvedPreset, config: PresetConfig): string {
  const registryPath = join(agentDir, "mcp-registry.json");
  if (!existsSync(registryPath)) throw new Error(`MCP registry is missing: ${registryPath}`);
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as { mcpServers?: Record<string, unknown> };
  for (const id of preset.mcp) {
    if (!registry.mcpServers || !registry.mcpServers[id]) throw new Error(`MCP server is missing: ${id}`);
  }
  const path = join(agentDir, "preset-mcp.json");
  const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const snapshot: McpSnapshot = { version: 1, preset: preset.name, serverIds: [...new Set(preset.mcp)] };
  writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  return path;
}

export function readMcpSnapshot(agentDir: string): McpSnapshot {
  const path = join(agentDir, "preset-mcp.json");
  if (!existsSync(path)) return { version: 1, preset: null, serverIds: [] };
  return JSON.parse(readFileSync(path, "utf8")) as McpSnapshot;
}
