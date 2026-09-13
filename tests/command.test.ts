// /preset 子命令语法回归：与 provider-status 的 /usage 保持同一风格
// （status / edit / help + 领域扩展）。
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-preset-cmd-"));
const { default: workspacePresetExtension } = await import("../index.ts");

interface Notification {
	message: string;
	level: string;
}

function setup() {
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const pi = {
		registerCommand: (name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, definition),
		on: () => {},
	};
	workspacePresetExtension(pi as never);
	const notifications: Notification[] = [];
	const ctx = {
		hasUI: false,
		cwd: process.cwd(),
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			setStatus: () => {},
			select: async () => undefined,
		},
	};
	return { invoke: (args: string) => commands.get("preset")!.handler(args, ctx), notifications };
}

test("/preset help 显示统一用法", async () => {
	const { invoke, notifications } = setup();
	await invoke("help");
	assert.equal(notifications.at(-1)!.level, "info");
	assert.match(notifications.at(-1)!.message, /usage: \/preset \[status \| edit \| help \| <name>\]/);
});

test("/preset status 与无参无 UI 都显示当前激活项", async () => {
	const { invoke, notifications } = setup();
	await invoke("status");
	assert.equal(notifications.at(-1)!.message, "Preset: Base");
	await invoke("");
	assert.equal(notifications.at(-1)!.message, "Preset: Base");
});

test("/preset edit 在无 UI 时提示需要 TUI", async () => {
	const { invoke, notifications } = setup();
	await invoke("edit");
	assert.equal(notifications.at(-1)!.level, "warning");
	assert.match(notifications.at(-1)!.message, /需要交互式 TUI/);
});
