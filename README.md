# pi-workspace-preset

官方 Pi 的普通用户扩展：读取 `~/.pi/agent/presets.yml`，把"预设"应用到当前会话（模型、思考等级、工具、skills/MCP/extensions/packages 启用集合），并将当前选择记录到项目唯一的 canonical 路径 `.pi/preset.json`。

启动时会检测 pi 配置目录（`~/.pi/agent`），缺少 `presets.yml` 时自动初始化一份基础配置（`version: 1` + 空 `resources`/`base`/`presets`）；已存在则不做任何改动。

边界：它不动态卸载/加载官方 loader 不支持热切换的 extension/package，也不实现 MCP 协议。MCP 选择由 adapter owner（`pi-mcp-adapter`）负责；缺失资源必须在切换前报告，不会静默联网安装。

## 相关文件

| 文件 | 角色 |
|---|---|
| `~/.pi/agent/presets.yml` | 唯一的用户配置：resources 注册表、base 模板、命名 presets |
| `<项目>/.pi/preset.json` | 项目级激活记录（`{"preset": "name"}`；Base 时文件被清除）。`session_start` 时读取：恢复激活状态标记并生成 MCP 快照（模型/工具等 settings 不在会话启动时自动应用，仍以 `/preset` 或面板切换为准） |
| `~/.pi/agent/preset-mcp.json` | MCP 快照（`{version, preset, serverIds}`），供 `pi-mcp-adapter` 消费 |
| `~/.pi/agent/mcp-registry.json` | 只读引用：MCP server 的权威注册表，快照生成前校验 server 存在 |
| `~/.pi/agent/preset-runtime/shared.ts` | 可选。存在时，把选中的 MCP server 子集交给 `pi-mcp-adapter` 安装 |

## 命令

| 命令 | 行为 |
|---|---|
| `/preset` | 弹出选择列表（Base + 全部命名 preset），选中即激活 |
| `/preset <name>` | 直接激活指定 preset（`Base`/`base` 激活空 preset；`status` 查看当前激活项） |
| `/preset edit` | 打开 TUI 编辑面板（需要交互式 UI），覆盖 presets.yml 全部配置项 |

激活行为：应用 settings（模型/思考等级/工具）→ 生成 `preset-mcp.json` 快照 → 写入项目 `.pi/preset.json` → 若切换了 preset 则调用 `ctx.reload()`（重载 skills/MCP/extensions/packages 生效）。失败时回滚项目选择并报错。

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
| `resources.<group>` | 四个资源组：`skills`、`mcp`、`extensions`、`packages`；ID 列表或对象注册表（对象形态可编辑定义体） |
| `enable.<group>` | 该 preset 启用的资源 ID；运行时与 base 的同名组**拼接并集**（base 在前，重名去重展示） |
| `settings.defaultProvider` + `defaultModel` | 切换默认模型（两者需同时设置；找不到模型或无认证时报错回滚） |
| `settings.defaultThinkingLevel` | 思考等级：`off/minimal/low/medium/high/xhigh/max` |
| `settings.tools` | 激活的工具名列表（工具必须存在，未知工具报错回滚）；未设置则不改动当前工具集 |

其它任意 settings key 允许存在（schema 不限制），编辑时走"settings 原始 JSON"兜底；运行时只消费上述四个字段。

### 合并语义

- `enable`：base 与 preset **拼接**（preset 无法表达"排除继承项"）；
- `settings`：preset 同名键**整体覆盖** base（浅合并）；
- 编辑面板把合并后的有效值预填写出来，继承字段带（继承）标记；留空即删除自身覆盖、恢复继承。

## TUI 编辑面板（/preset edit）

主面板按键：**Enter** 编辑选中条目 / **s** 切换激活 / **n** 新建 preset / **d** 删除 preset / **q** 退出。

面板条目：激活行（切换当前会话 preset，复用 `/preset` 的应用逻辑）、`base 段`、各命名 preset、`resources` 四组注册表。

### 编辑 preset / base

同一张表单：

- `enable.*`：多选切换菜单，只允许从 resources 注册表中选择；计数显示合并视图（自身 + 继承）；继承项标记（继承），不可在 preset 层取消（合并语义为拼接），按 Enter 会提示去 base 段操作；
- `settings` 四个常用字段：输入框预填有效值（自身覆盖 → base 继承）并标记（继承）；留空即恢复继承；确认值与继承值完全一致时不落为自身覆盖；
- `settings 原始 JSON`：兜底编辑全部设置。

### 编辑 resources

`n` 新增 ID / **Enter** 编辑定义体（对象形态）/ `d` 删除。每次动作立即校验并原子落盘。

### 原子性

面板每次动作前都重新 `loadPresetConfig`，改动后经 `savePresetConfig` 校验并原子写入（临时文件 + rename）。外部修改不会导致保存失败，最多表现为列表显示稍有滞后（下一轮自动重读）。

## 安全与限制

- 配置文件、快照、项目选择文件均以 `0600` 权限原子写入；
- 第三方 extension/package 不通过 preset 动态卸载；它们必须预先安装并由官方 settings/resource loader 管理；
- MCP 不在本扩展实现协议，只生成快照并（可选）委托 runtime 安装。

## 开发与测试

```
npm test   # node --test 覆盖 loader、mutations、project-selection 纯逻辑
```
