# pi-workspace-preset

读 `~/.pi/agent/presets.json`，把一套预设应用到当前会话：默认模型、思考等级、工具白名单，以及 skills / MCP / extensions / packages 的启用集合。当前选择记在项目的 `<项目>/.pi/preset.json`；选 Base 时会删掉它，文件缺失同样视为 Base。

它只管切换，不管安装：extension 和 package 要事先装好，由 pi 自己的 loader 管，preset 不会动态卸载。MCP 协议也不在这里实现，只写一份 `~/.pi/agent/preset-mcp.json` 快照；`~/.pi/agent/preset-runtime/shared.ts` 存在时，会把快照里的 server ID 交给它的 `installPresetMcp`（通常对应 `pi-mcp-adapter`）去装。

## 配置

`presets.json` 不存在时，扩展加载会初始化一份空的（`version: 1`）。

```json
{
  "version": 1,
  "resources": {
    "skills": ["code-review", "sql-helper"],
    "mcp": { "context7": { "command": "npx", "args": ["..."] } }
  },
  "base": {
    "enable": { "skills": ["code-review"], "mcp": ["context7"] },
    "settings": { "defaultThinkingLevel": "low" }
  },
  "presets": {
    "heavy": {
      "enable": { "skills": ["sql-helper"] },
      "settings": { "defaultProvider": "openrouter", "defaultModel": "some/model", "tools": ["read", "bash"] }
    }
  }
}
```

`resources` 是可选资源的注册表（先注册才能在 preset 里用）：`skills` / `mcp` 这种写 ID 数组，也可以写成 `ID → 定义对象`。四个资源组是 `skills`、`mcp`、`extensions`、`packages`。`enable.*` 只能填注册过的 ID，写错在切换时报错。base 和 preset 合并时，`enable` 是拼接（base 在前，preset 没法排除继承项），`settings` 按 key 覆盖。

`settings` 里实际生效的是 `defaultProvider` + `defaultModel`（成对写才切换模型，只写一个不生效；找不到模型或没认证会报错）、`defaultThinkingLevel`、`tools`；其它键存着可以，运行时不用。

## 命令

| 命令 | 行为 |
|---|---|
| `/preset` | 弹出列表（Base + 命名 preset），选中即激活；没有交互式 UI 时显示当前项 |
| `/preset <name>` | 直接激活，`/preset base` 回到 Base |
| `/preset status` | 看当前激活项 |
| `/preset config`（别名 `edit`） | 打开 TUI 编辑面板 |
| `/preset help` | 显示用法 |

preset 名大小写敏感；`status` / `config` / `edit` / `help` / `base` 会被命令解析先消费，所以同名的 preset 只能从列表或面板里激活。

## 激活流程

选中后依次：合并 base 与 preset 并校验 `enable.*` 的 ID，应用 settings，写 MCP 快照和项目记录，更新状态栏。中途任何一步失败，项目记录回退到上一次的激活项并报错；已经改掉的模型、思考等级、工具不回退。

`presets.json` 内容变了，或者激活项变了且资源集合跟着变，会触发 `ctx.reload()`。只改模型、思考等级、工具不 reload。在项目里开会话时，只按记录恢复资源集合和状态栏，模型、思考等级、工具不自动应用。

## TUI 面板（/preset config）

主面板是 `激活` / `预设列表` / `基础段` / `资源注册表` / `退出`。预设列表里 `n` 新建、`s` 激活、`d` 删除；基础段和 preset 共用一套编辑器，第一层是四个资源组加 `设置`、`原始 JSON`、`保存`，`Ctrl+S` 在任意一层都能保存。按 `?` 看快捷键和对应的 JSON 键。

面板每次动作前重新读配置，保存前整体校验，写盘用临时文件加 rename。

## 几个已知点

- `presets.json`、`preset-mcp.json`、`.pi/preset.json` 都以 `0600` 原子写入。
- MCP 快照生成前会逐个核对 `~/.pi/agent/mcp-registry.json`，引用的 server 不在注册表里就直接报错；快照里的 `serverIds` 已去重。
- `tools` 里还没加载的工具只告警不阻断（切换启用的 extension/package 注册后会自动并入）。
- 编辑器会把合并后的有效值预填出来，继承项标（继承）：settings 字段留空就恢复继承，`enable.*` 的继承项不能在 preset 层取消（合并是拼接），要去 base 段改。

## 开发

```
npm test   # preset schema 与合并、资源注册表 mutation、项目选择读写、命令与 TUI 菜单纯逻辑
```
