import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasResourceSelectionChanged, resolvePreset } from "../preset-loader.ts";
import { readProjectPreset, writeProjectPreset } from "../project-selection.ts";
import { validatePresetConfig } from "../preset-schema.ts";

test("validates version and resource groups", () => {
  assert.doesNotThrow(() => validatePresetConfig({ version: 1, base: { enable: { mcp: ["codegraph"] } } }, "fixture"));
  assert.throws(() => validatePresetConfig({ version: 2 }, "fixture"), /version/);
  assert.throws(() => validatePresetConfig({ version: 1, base: { enable: { nope: [] } } }, "fixture"), /unknown resource group/);
});

test("merges base and named preset settings", () => {
  const resolved = resolvePreset({
    version: 1,
    resources: { packages: ["base"], mcp: ["web"] },
    base: { enable: { packages: ["base"] }, settings: { defaultModel: "base" } },
    presets: { Vue: { enable: { mcp: ["web"] }, settings: { defaultModel: "vue" } } },
  }, "Vue");
  assert.deepEqual(resolved.packages, ["base"]);
  assert.deepEqual(resolved.mcp, ["web"]);
  assert.equal(resolved.settings.defaultModel, "vue");
});

test("writes and clears the canonical project selection", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-workspace-preset-"));
  writeProjectPreset(cwd, "Vue");
  assert.equal(readProjectPreset(cwd), "Vue");
  assert.match(readFileSync(join(cwd, ".pi", "preset.json"), "utf8"), /Vue/);
  writeProjectPreset(cwd, null);
  assert.equal(readProjectPreset(cwd), null);
});

test("资源选择变化只由 skills/mcp/extensions/packages 决定", () => {
  const base = { name: null, skills: [], mcp: [], extensions: [], packages: [], settings: {} };
  // 仅 settings 变化（模型/思考等级/工具）不需要重载运行时。
  assert.equal(hasResourceSelectionChanged(base, { ...base, settings: { defaultModel: "m" } }), false);
  // 顺序与重复不影响结论。
  assert.equal(
    hasResourceSelectionChanged({ ...base, skills: ["a", "b"] }, { ...base, skills: ["b", "a", "a"] }),
    false,
  );
  assert.equal(hasResourceSelectionChanged(base, { ...base, mcp: ["context7"] }), true);
  assert.equal(hasResourceSelectionChanged({ ...base, packages: ["p"] }, base), true);
});
