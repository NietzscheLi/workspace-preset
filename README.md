# pi-workspace-preset

官方 Pi 普通用户扩展：读取 `~/.pi/agent/presets.yml`，把"预设"应用到当前会话（模型、思考等级、工具白名单，以及 skills / MCP / extensions / packages 的启用集合），并把当前选择记录到项目唯一的 canonical 路径 `<项目>/.pi/preset.json`。

边界：它不动态卸载/加载官方 loader 不支持热切换的 extension/package，也不实现 MCP 协议。MCP 选择由 adapter owner（`pi-mcp-adapter`）负责；缺失资源必须在切换前报告，不会静默联网安装。

## 相关文件

| 文件 | 角色 |
|---|---|
| `~/.pi/agent/presets.yml` | 唯一的用户配置：`resources` 注册表、`base` 全局模板、命名 `presets`。扩展加载时若缺失则初始化一份基础配置（`version: 1` + 空 `resources`/`base`/`presets`），已存在则不做任何改动 |
| `<项目>/.pi/preset.json` | 项目级激活记录（`{"preset": "name"}`；Base 时文件被删除，缺失同样视为 Base）。`0600` + 原子写入 |
| `~/.pi/agent/preset-mcp.json` | MCP 快照（`{version: 1, preset, serverIds}`，`serverIds` 已去重），供 `pi-mcp-adapter` 消费 |
| `~/.pi/agent/mcp-registry.json` | 只读引用：MCP server 的权威注册表（`mcpServers.<id>`）；快照生成前逐个校验 server 存在，缺失即报错 |
| `~/.pi/agent/preset-runtime/shared.ts` | 可选。存在且快照里有 server 时，动态 import 并调用其 `installPresetMcp(pi, serverIds)`，把选中的 MCP server 子集交给 `pi-mcp-adapter` 安装 |

## 命令

| 命令 | 行为 |
|---|---|
| `/preset` | 弹出选择列表（`Base` + 全部命名 preset），选中即激活；无交互式 UI 时显示当前激活项 |
| `/preset <name>` | 直接激活指定 preset（`/preset base` 激活 Base，即不启用任何命名 preset） |
| `/preset status` | 查看当前激活项 |
| `/preset config`（别名 `/preset edit`） | 打开 TUI 编辑面板（需要交互式 UI），覆盖 presets.yml 全部配置项 |
| `/preset help` | 显示可用子命令 `usage: /preset [status | config | help | <name>]` |

- 子命令风格与 `provider-status` 的 `/usage` 保持一致；
- 子命令判定用**首个小写化 token**，preset 名称本身**大小写敏感**并按原样解析（`/preset Heavy` 激活 `Heavy`，不会命中 `heavy`）；
- `status` / `config` / `edit` / `help` / `base` 被命令解析优先消费，因此同名 preset 无法通过 `/preset <name>` 激活（在 `/preset` 选择列表和面板里仍可正常激活）。

### 激活流程

`/preset`、选择列表与 TUI 面板共用同一段逻辑，顺序固定：

1. `loadPresetConfig` + `resolvePreset`：合并 base 与命名 preset，校验 `enable.*` 里的 ID 都已在 `resources` 注册；
2. 应用 settings：`defaultProvider` + `defaultModel`（需同时设置，找不到模型或缺认证即报错）、`defaultThinkingLevel`、`tools`（尚未加载的工具只告警）；
3. 写 `preset-mcp.json` 快照（校验 `mcp-registry.json`）；
4. 写项目 `.pi/preset.json`；
5. 更新状态栏键 `preset`（Base 时为 `undefined`）；
6. 需要 `ctx.reload()` 的情况：`presets.yml` 内容自上次应用后发生变化，或激活项不同且资源集合（skills/mcp/extensions/packages）发生变化。会话启动已按项目记录安装过资源，因此启动后首次激活同一 preset 只应用 settings、不重载；只改模型/思考等级/工具时不 reload（Pi 0.86.0 起会把这类变更写入 transcript 并在 resume/branch 后保持）。激活项与文件都未变时只提示 `Preset activated: <name>`。

任一步失败：把项目选择**回滚为上一次的激活项**并以 error 提示；已经生效的模型/思考等级/工具不做回滚。

## 配置参考（presets.yml）

```yaml
version: 1

# resources：可选资源的注册表。enable 里出现的 ID 必须已在这里注册。
resources:
  skills: [code-review, sql-helper]        # 形态一：纯 ID 列表
  mcp:                                      # 形态二：ID -> 定义对象
    context7: { command: npx, args: [...] }

# base：全局模板，所有命名 preset 的继承来源。
base:
  enable: { skills: [code-review], mcp: [context7] }
  settings: { defaultThinkingLevel: low }

# presets：命名预设。
presets:
  heavy:
    enable: { skills: [sql-helper] }
    settings: { defaultProvider: openrouter, defaultModel: some/model, tools: [read, bash] }
```

### 字段含义

| 字段 | 说明 |
|---|---|
| `version` | 必须为 `1`，由代码管理，不提供编辑 |
| `resources.<group>` | 四个资源组：`skills`、`mcp`、`extensions`、`packages`；每组的注册表可以是 ID 列表，也可以是 `ID -> 定义对象`（对象形态在面板里可编辑定义体） |
| `enable.<group>` | 该 preset 启用的资源 ID；只能填已注册的 ID，未知 ID 在 `resolvePreset` 时报错 |
| `settings.defaultProvider` + `defaultModel` | 切换默认模型（两者需同时设置；找不到模型或无认证时报错回滚） |
| `settings.defaultThinkingLevel` | 思考等级：`off/minimal/low/medium/high/xhigh/max` |
| `settings.tools` | 激活的工具名列表；尚未加载的工具（由本次切换启用的 extension/package 在 reload 后注册，Pi 会自动并入）只告警，不阻断激活；未设置则不改动当前工具集 |

其它任意 settings key 允许存在（schema 不限制），编辑时走"settings 原始 JSON"兜底；运行时只消费上述四个字段。

### 合并语义

- `enable`：base 与 preset **拼接**（base 在前、运行时不去重；preset 无法表达"排除继承项"）；
- `settings`：preset 同名键**整体覆盖** base（浅合并）；
- 编辑面板把合并后的有效值预填写出来，继承字段带（继承）标记；留空即删除自身覆盖、恢复继承；确认值与继承值完全一致时不会落成自身覆盖。

## 启动时（session_start）

读取 `<项目>/.pi/preset.json`，按记录解析 preset，生成 `preset-mcp.json` 快照，必要时调用 `installPresetMcp`，并恢复状态栏键。**模型/思考等级/工具不在会话启动时自动应用**——它们仍以 `/preset`、选择列表或面板的切换为准。项目记录若指向已删除的 preset，或快照引用的 MCP server 已从注册表移除，都会在解析时报错。

## TUI 编辑面板（/preset config）

每次动作前都重新 `loadPresetConfig`，改动后经 `savePresetConfig` 校验并原子写入。两级导航；行上只显示中文标签，按 **?** 在帮助浮层里查看对应的 YAML 键（`enable.*` / `settings.*` / `resources.*`）：

- **主面板**：`激活` / `预设列表` / `基础段` / `资源注册表` / `退出`。`↑↓` 选择，**Enter** 进入，`q` / `Esc` 退出；
- **预设列表页**：`＋ 新建 preset` + 命名 preset 列表（已激活项带标记）。`↑↓` 选择，**Enter** 编辑，`n` 新建，`s` 激活，`d` 删除（有确认弹窗），`Esc` 返回；
- **资源注册表页**：`技能` / `MCP 服务` / `扩展` / `包` 四个资源组；**Enter** 进入注册表管理（`n` 新增 / **Enter** 编辑定义体（对象形态）/ `d` 删除）；
- **激活**：面板内的切换复用 `/preset` 的激活逻辑（含 `ctx.reload()`）；
- 任意界面按 **?** 打开完整快捷键与说明浮层。

### 编辑 preset / base

第一层为 `技能` / `MCP 服务` / `扩展` / `包`（对应 `enable.*`）、`设置` 分节、`原始 JSON` 与 `保存`；**Enter** 进入分节，**Ctrl+S** 在任意一层保存：

- `enable.*`：多选切换菜单，只允许从 resources 注册表中选择；计数显示合并视图（自身 + 继承）；继承项标记（继承），不可在 preset 层取消（合并语义为拼接），按 Enter 会提示去 base 段操作；
- `设置`：`默认 Provider` / `默认模型` / `默认思考等级` / `工具白名单`（对应 `settings.defaultProvider` / `defaultModel` / `defaultThinkingLevel` / `tools`，工具为逗号或空白分隔）；输入框预填有效值（自身覆盖 → base 继承）并标记（继承）；留空即恢复继承；
- `原始 JSON`：兜底编辑全部 settings。

### 编辑 resources

**Enter** 进入资源组后：`n` 新增 ID / **Enter** 编辑定义体（对象形态）/ `d` 删除。每次动作立即校验并原子落盘；删除 ID 后，引用它的 preset 需要同步调整。

## 安全与限制

- `presets.yml`、`preset-mcp.json`、`.pi/preset.json` 均以 `0600` 权限原子写入（临时文件 + rename）；
- 第三方 extension/package 不通过 preset 动态卸载；它们必须预先安装并由官方 settings/resource loader 管理；
- MCP 不在本扩展实现协议，只生成快照并（可选）委托 `preset-runtime/shared.ts` 安装。

## 开发与测试

```
npm test   # node --test：preset schema 与合并、资源注册表 mutation、项目选择读写、命令与 TUI 菜单纯逻辑
```
