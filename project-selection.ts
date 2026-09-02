import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function readProjectPreset(cwd: string): string | null {
  const path = join(cwd, ".pi", "preset.json");
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as { preset?: unknown };
  if (value.preset !== null && typeof value.preset !== "string") throw new Error(`${path} must contain a string or null preset`);
  return value.preset === null ? null : value.preset;
}

export function writeProjectPreset(cwd: string, preset: string | null): void {
  const dir = join(cwd, ".pi");
  const path = join(dir, "preset.json");
  mkdirSync(dir, { recursive: true });
  if (preset === null) { if (existsSync(path)) unlinkSync(path); return; }
  const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ preset }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
