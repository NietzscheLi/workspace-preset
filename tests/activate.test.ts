// 激活路径回归：presets.json 内容变化必须重载；同文件内仅 settings 变化时切换 preset 走轻量路径。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const agentDir = mkdtempSync(join(tmpdir(), "pi-preset-activate-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const PRESETS = `${JSON.stringify({
	version: 1,
	resources: { mcp: ["alpha"] },
	presets: {
		work: { enable: { mcp: ["alpha"] }, settings: { defaultThinkingLevel: "low" } },
		quiet: { enable: { mcp: ["alpha"] }, settings: { defaultThinkingLevel: "high" } },
		tooling: { enable: { mcp: ["alpha"] }, settings: { tools: ["read", "future-tool"] } },
	},
}, null, 2)}\n`;

writeFileSync(join(agentDir, "presets.json"), PRESETS);
writeFileSync(join(agentDir, "mcp-registry.json"), JSON.stringify({ mcpServers: { alpha: { command: "noop" } } }));

const { default: workspacePresetExtension } = await import("../index.ts");

function setup() {
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
	const pi = {
		registerCommand: (name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, definition),
		on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => {
			handlers.set(name, handler);
			return () => undefined;
		},
		getThinkingLevel: () => "medium" as const,
		setThinkingLevel: () => {},
		getActiveTools: () => [] as string[],
		getAllTools: () => [{ name: "read" }, { name: "bash" }],
		setActiveTools: () => {},
		setModel: async () => true,
	};
	workspacePresetExtension(pi as never);
	const cwd = mkdtempSync(join(tmpdir(), "pi-preset-project-"));
	let reloads = 0;
	const notifications: string[] = [];
	const ctx = {
		hasUI: false,
		cwd,
		model: undefined,
		modelRegistry: { find: () => undefined },
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: () => {},
			select: async () => undefined,
		},
		reload: async () => {
			reloads += 1;
		},
	};
	return {
		invoke: (args: string) => commands.get("preset")!.handler(args, ctx),
		cwd,
		sessionStart: async () => {
			await handlers.get("session_start")!({ reason: "startup" }, ctx);
		},
		reloads: () => reloads,
		notifications,
	};
}

test("session_start 建立基线：启动后激活同一 preset 不重载", async () => {
	const harness = setup();
	writeFileSync(join(agentDir, "presets.json"), PRESETS);
	mkdirSync(join(harness.cwd, ".pi"), { recursive: true });
	writeFileSync(join(harness.cwd, ".pi", "preset.json"), JSON.stringify({ preset: "work" }));

	await harness.sessionStart();
	assert.equal(harness.reloads(), 0);

	await harness.invoke("work");
	assert.equal(harness.reloads(), 0);
	assert.equal(harness.notifications.at(-1), "Preset activated: work");
});

test("尚未加载的工具只告警，不阻断激活", async () => {
	const harness = setup();
	await harness.invoke("tooling");
	assert.equal(harness.reloads(), 1);
	const warning = harness.notifications.find((message) => message.includes("future-tool"));
	assert.ok(warning, `expected a warning about future-tool, got: ${harness.notifications.join(" | ")}`);
});

test("presets.json 变化触发重载，同文件内的 settings-only 切换不重载", async () => {
	const harness = setup();

	// 本会话首次激活：无论资源是否变化都要建立运行时基线。
	await harness.invoke("work");
	assert.equal(harness.reloads(), 1);

	// 同名重复激活、文件未变：不重载。
	await harness.invoke("work");
	assert.equal(harness.reloads(), 1);

	// 只改 settings：文件签名变化必须重载（这是回归保护点）。
	writeFileSync(join(agentDir, "presets.json"), PRESETS.replace('"defaultThinkingLevel": "low"', '"defaultThinkingLevel": "xhigh"'));
	await harness.invoke("work");
	assert.equal(harness.reloads(), 2);

	// 不同 preset、资源集合相同、文件未变：轻量路径。
	await harness.invoke("quiet");
	assert.equal(harness.reloads(), 2);
	assert.equal(harness.notifications.at(-1), "Preset activated: quiet");
});
