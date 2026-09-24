import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	ensurePresetConfigFile,
	loadPresetConfig,
	savePresetConfig,
} from "../preset-loader.ts";
import {
	isObjectRegistry,
	parseToolsInput,
	registryDefinition,
	removeRegistryEntry,
	resourceIds,
	setRegistryEntry,
	toggleInList,
} from "../preset-mutations.ts";
import type { PresetConfig } from "../types.ts";

function makeDir(): string {
	return mkdtempSync(join("/tmp", "pi-workspace-preset-edit-"));
}

test("ensurePresetConfigFile 初始化基础配置且不覆盖已有文件", () => {
	const dir = makeDir();
	ensurePresetConfigFile(dir);
	assert.ok(existsSync(join(dir, "presets.json")));
	const config = loadPresetConfig(dir);
	assert.equal(config.version, 1);
	assert.deepEqual(config.resources, {});
	assert.deepEqual(config.presets, {});
	// 已有文件不被覆盖。
	writeFileSync(join(dir, "presets.json"), '{"version":1,"presets":{"mine":{}}}');
	ensurePresetConfigFile(dir);
	assert.deepEqual(loadPresetConfig(dir).presets, { mine: {} });
});

test("savePresetConfig 校验并原子保存", () => {
	const dir = makeDir();
	const config: PresetConfig = { version: 1, resources: { skills: ["a", "b"] }, presets: { work: { enable: { skills: ["a"] } } } };
	savePresetConfig(dir, config);
	const reread = loadPresetConfig(dir);
	assert.deepEqual(reread.resources?.skills, ["a", "b"]);
	// 非法版本被拒绝，文件保持不变。
	const before = readFileSync(join(dir, "presets.json"), "utf8");
	assert.throws(() => savePresetConfig(dir, { ...config, version: 2 as unknown as 1 }));
	assert.equal(readFileSync(join(dir, "presets.json"), "utf8"), before);
});

test("resourceIds / isObjectRegistry 兼容数组和对象注册表", () => {
	const arrayConfig: PresetConfig = { version: 1, resources: { skills: ["a", "b"] } };
	assert.deepEqual(resourceIds(arrayConfig, "skills"), ["a", "b"]);
	assert.equal(isObjectRegistry(arrayConfig, "skills"), false);
	const objectConfig: PresetConfig = { version: 1, resources: { mcp: { fs: { command: "uvx" } } } };
	assert.deepEqual(resourceIds(objectConfig, "mcp"), ["fs"]);
	assert.equal(isObjectRegistry(objectConfig, "mcp"), true);
	assert.deepEqual(resourceIds({ version: 1 } as PresetConfig, "packages"), []);
});

test("setRegistryEntry / removeRegistryEntry 保留形态", () => {
	const objectConfig: PresetConfig = { version: 1, resources: { mcp: { fs: { command: "uvx" } } } };
	setRegistryEntry(objectConfig, "mcp", "git", { command: "git" });
	assert.deepEqual(registryDefinition(objectConfig, "mcp", "git"), { command: "git" });
	removeRegistryEntry(objectConfig, "mcp", "fs");
	assert.deepEqual(Object.keys(objectConfig.resources!.mcp as Record<string, unknown>), ["git"]);

	const arrayConfig: PresetConfig = { version: 1, resources: { skills: ["a"] } };
	setRegistryEntry(arrayConfig, "skills", "b", { ignored: true });
	assert.deepEqual(arrayConfig.resources!.skills, ["a", "b"]);
	removeRegistryEntry(arrayConfig, "skills", "a");
	assert.deepEqual(arrayConfig.resources!.skills, ["b"]);

	const missingConfig: PresetConfig = { version: 1 };
	setRegistryEntry(missingConfig, "packages", "p", undefined);
	assert.ok(missingConfig.resources);
});

test("toggleInList / parseToolsInput", () => {
	assert.deepEqual(toggleInList(["a"], "b"), ["a", "b"]);
	assert.deepEqual(toggleInList(["a", "b"], "a"), ["b"]);
	assert.deepEqual(parseToolsInput("read, bash  edit"), ["read", "bash", "edit"]);
	assert.deepEqual(parseToolsInput(""), []);
});