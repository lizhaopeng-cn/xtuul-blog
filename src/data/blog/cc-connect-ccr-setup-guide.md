---
author: Xtuul
pubDatetime: 2026-04-28T15:56:26+08:00
title: 把 Claude Code 搬进飞书和 Telegram：cc-connect + CCR 完整架构、安装流程与踩坑全记录
slug: cc-connect-ccr-setup-guide
featured: false
draft: false
tags:
  - claude-code
  - automation
  - devops
description: IM（飞书 / Telegram）⇄ cc-connect ⇄ Claude Code ⇄ CCR ⇄ OpenRouter ⇄ 多家大模型。手机上用 Claude Code 的一整套工程化方案，含语音转写、MCP、launchd 守护和 13 个踩坑实录。
crosspost:
  devto:
    id: 3561327
    url: "https://dev.to/lizhaopengcn/ba-claude-code-ban-jin-fei-shu-he-telegramcc-connect-ccr-wan-zheng-jia-gou-an-zhuang-liu-cheng-yu-cai-keng-quan-ji-lu-1d0l"
  hashnode:
    id: 69f078059798a77fdc3bb2f5
    url: "https://xtuul.hashnode.dev/claude-code-telegramcc-connect-ccr"
---

**本篇讲什么**：一套让你在手机上用 Claude Code 的工程化方案——`IM（飞书 / Telegram）⇄ cc-connect ⇄ Claude Code ⇄ CCR ⇄ OpenRouter ⇄ 多家大模型`。含语音转写（Groq Whisper）、MCP（Stitch）、launchd 守护、模型按需切换，外加 13 个一路踩过的坑。

**本篇不讲什么**：Claude Code 本身怎么用、OpenRouter 怎么注册、飞书/Telegram 是什么。默认你已经跑过 `claude` 桌面端，有 OpenRouter 账号，对命令行不陌生。

## 目录

## 一、为什么要做这套东西

日常写代码离不开 Claude Code，但桌面端有个硬伤：

- **开会 / 出门 / 蹲厕所** 的时候脑子里冒出改一行代码的想法，没电脑在旁边就凉了
- 想让它后台跑一个重构 / 搜资料任务，也不方便时不时回电脑前看进度
- 偶尔一条语音表达比打字快得多，Claude Code 桌面端不吃语音

**目标：** 手机上通过飞书 / Telegram 直接和 Claude Code 对话，可发文字、发语音、切模型、恢复之前的 session、用 MCP 工具。电脑端和手机端最好能看到同一批 session。

用到的组件：

| 组件 | 作用 |
|---|---|
| `cc-connect` | IM 桥接器，把飞书/Telegram 消息转成 Claude Code 的输入 |
| `claude-code-router` (CCR) | 本地反向代理，把 Claude Code 的请求路由到 OpenRouter / 其他厂商，支持按 alias 切模型 |
| OpenRouter | 聚合多家模型（Anthropic / OpenAI / Google / Qwen ...），一个 key 搞定 |
| ffmpeg + Groq Whisper | 把飞书/Telegram 的语音消息转成文字 |
| launchd | macOS 上把 cc-connect 做成开机自启的守护进程 |

---

## 二、整体架构

```text
┌────────────────┐         ┌────────────────┐
│   飞书客户端   │         │ Telegram 客户端 │
└────────┬───────┘         └────────┬───────┘
         │  消息 / 语音               │
         ▼                            ▼
         ┌───────────────────────────────┐
         │    cc-connect (launchd daemon)│   ← 监听两个平台，做消息协议转换
         │                               │
         │   ┌───────────────────────┐   │
         │   │ Groq Whisper (语音转) │   │
         │   └───────────────────────┘   │
         └──────────────┬────────────────┘
                        │  fork 子进程
                        ▼
           ┌────────────────────────────┐
           │  claude (Claude Code CLI)  │
           │                            │
           │   ANTHROPIC_BASE_URL=      │
           │     http://127.0.0.1:3456  │
           │   ANTHROPIC_API_KEY=dummy  │
           └──────────────┬─────────────┘
                          │  Anthropic 协议
                          ▼
           ┌────────────────────────────┐
           │   CCR (claude-code-router) │
           │   127.0.0.1:3456           │
           │                            │
           │   router.js:               │
           │   - /model <alias>         │
           │   - "alias:" 前缀          │
           │   - longContextThreshold   │
           │   - default Router         │
           └──────────────┬─────────────┘
                          │  各家原生协议
                          ▼
           ┌────────────────────────────────┐
           │  OpenRouter / 其他 provider    │
           │  anthropic/claude-4.7-opus     │
           │  anthropic/claude-4.6-sonnet   │
           │  anthropic/claude-4.5-haiku    │
           │  openai/gpt-5.4                │
           │  openai/gpt-5.3-codex          │
           │  google/gemini-3.1-pro         │
           │  qwen/qwen3.6-plus             │
           │  ...:free 系列用另一个 key     │
           └────────────────────────────────┘
```

**几个关键的数据流：**

- **文字消息**：IM → cc-connect → claude 子进程 (stdin) → CCR → OpenRouter → 回流
- **语音消息**：IM → cc-connect 下载 ogg/mp3 → ffmpeg 转码 → Groq Whisper → 文本 → 当作文字消息走
- **MCP 工具**：claude 子进程按需 HTTP 调用 `https://stitch.googleapis.com/mcp`（header 里带 key）
- **session 持久化**：每轮对话的 jsonl 存在 `~/.claude/projects/-Users-xtuul/`，和桌面端 `ccr code` 共用一个目录

---

## 三、安装流程（macOS，一步步来）

> 假设你已经装过 Node.js（推荐 22.x，用 nvm 管理）、Claude Code CLI、以及有一个 OpenRouter 账号。

### 3.1 装 CCR（claude-code-router）

```bash
npm i -g @musistudio/claude-code-router
```

配置文件在 `~/.claude-code-router/`：

- `config.json` — Providers 列表、Router 规则、APIKEY 等
- `router.js` — 自定义路由脚本（可选，但强烈推荐）

`config.json` 示例（我本机跑着的就是这套，两个账号：`or` 是付费主账号，`or1` 跑免费模型）：

```json
{
  "LOG": true,
  "HOST": "127.0.0.1",
  "PORT": 3456,
  "APIKEY": "",
  "API_TIMEOUT_MS": "600000",
  "Providers": [
    {
      "name": "or",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "sk-or-v1-...主 key...",
      "models": [
        "anthropic/claude-4.7-opus-20260416",
        "anthropic/claude-4.6-sonnet-20260217",
        "anthropic/claude-4.5-haiku-20251001",
        "openai/gpt-5.4-20260305",
        "openai/gpt-5.3-codex-20260224",
        "google/gemini-3.1-pro-preview-20260219",
        "qwen/qwen3.6-plus-04-02"
      ],
      "transformer": { "use": ["openrouter"] }
    },
    {
      "name": "or1",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "sk-or-v1-...备用 key 跑免费模型...",
      "models": [
        "openrouter/free",
        "nvidia/nemotron-3-super-120b-a12b:free"
      ],
      "transformer": { "use": ["openrouter"] }
    }
  ],
  "Router": {
    "default":       "or,anthropic/claude-4.7-opus-20260416",
    "background":    "or,anthropic/claude-4.6-sonnet-20260217",
    "think":         "or,anthropic/claude-4.7-opus-20260416",
    "longContext":   "or,anthropic/claude-4.7-opus-20260416",
    "longContextThreshold": 180000,
    "webSearch":     "",
    "image":         "or,openai/gpt-5.4-20260305"
  },
  "CUSTOM_ROUTER_PATH": "/Users/你/.claude-code-router/router.js"
}
```

几个注意点：

- **provider `name` 就是 Router 值里 `,` 前面那一段**。我习惯用短名（`or` / `or1`），你叫 `openrouter` / `openrouter-free` 都行，只要 Router / router.js 里两边对得上
- `transformer: { use: ["openrouter"] }` 是 CCR 让 OpenRouter 协议生效的开关。不加这行，部分字段（比如 reasoning content、工具调用 schema）会发错格式给上游
- `longContextThreshold` 我拉到 `180000`：2026 年的模型上下文基本都是 200k+ / 1M，没必要 120k 就切模型
- `webSearch: ""` 是显式置空 —— 我不用 CCR 的 webSearch 路由，Claude Code 自己的 WebFetch 更好用

#### 几个重要的 Router 字段含义

| 字段 | 语义 |
|---|---|
| `default` | 兜底模型。其他路由规则都没命中时用这个 |
| `background` | 后台压缩/总结用的轻量模型。一般比 default 便宜/快 |
| `think` | 带 extended thinking 的长链路推理模型 |
| `longContext` | 单次请求 **input tokens ≥ longContextThreshold** 时切到这个模型。**注意：是单次请求的 input tokens，不是整个上下文窗口**，而且是**无状态**的 —— 这次超了走这个，下次没超还是走 default |
| `webSearch` | 带 web 搜索能力的模型（Gemini 系列通常最强） |
| `image` | 发送图片时用的 vision 模型（要选**分析**模型，不是**生成**模型） |

#### `router.js`（自定义路由，强烈推荐）

这个脚本给你两个人工切模型的方式：

**模式 A — 持久切换**：在 claude 聊天里输 `/model <alias>`，整个 session 都用这个 alias

**模式 B — 一次性切换**：消息以 `alias:` 开头，只这条走 alias，之后自动回退

```javascript
const ALIAS_MAP = {
  // ── or（主账号 / 付费模型）
  // ⚠️ Anthropic 系列的 key 必须用"带日期后缀的完整 ID"，原因见下文
  "claude-opus-4-7":           "or,anthropic/claude-4.7-opus-20260416",
  "claude-sonnet-4-6":         "or,anthropic/claude-4.6-sonnet-20260217",
  "claude-haiku-4-5-20251001": "or,anthropic/claude-4.5-haiku-20251001",
  // ── 其他家的模型，alias 短名就行
  "gpt":    "or,openai/gpt-5.4-20260305",
  "codex":  "or,openai/gpt-5.3-codex-20260224",
  "gemini": "or,google/gemini-3.1-pro-preview-20260219",
  "qwen":   "or,qwen/qwen3.6-plus-04-02",
  // ── or1（免费账号 / 免费模型）
  "free":   "or1,openrouter/free",
  "nvidia": "or1,nvidia/nemotron-3-super-120b-a12b:free",
};

const PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9_-]*):(\s|$)/;

function matchPrefix(text) {
  if (typeof text !== "string") return null;
  const m = text.match(PREFIX_RE);
  if (!m) return null;
  const alias = m[1].toLowerCase();
  const route = ALIAS_MAP[alias];
  if (!route) return null;
  return { alias, route, stripped: text.slice(m[0].length).trimStart() };
}

module.exports = async function router(req, config) {
  // 模式 A：body.model 是裸 alias（来自 /model <alias>）
  const rawModel = req?.body?.model;
  if (typeof rawModel === "string" && !rawModel.includes(",")) {
    const key = rawModel.toLowerCase();
    if (ALIAS_MAP[key]) return ALIAS_MAP[key];
  }

  // 模式 B：最后一条 user 消息以 "alias:" 开头
  const messages = req?.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  let lastUser = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") { lastUser = messages[i]; break; }
  }
  if (!lastUser) return null;

  if (typeof lastUser.content === "string") {
    const hit = matchPrefix(lastUser.content);
    if (!hit) return null;
    lastUser.content = hit.stripped;
    return hit.route;
  }

  if (Array.isArray(lastUser.content)) {
    // Claude Code 会注入 <system-reminder> 等前置 text block，真实输入常在后面
    for (const block of lastUser.content) {
      if (!block || typeof block !== "object" || block.type !== "text") continue;
      const hit = matchPrefix(block.text);
      if (!hit) continue;
      block.text = hit.stripped;
      return hit.route;
    }
  }

  return null;  // 都不匹配，回落 Router 默认规则
};
```

#### 为什么 Anthropic 模型的 key 必须写完整 ID

这是个很隐蔽的坑。

Claude Code **客户端本身对 Anthropic 自家模型名做了硬编码处理**，和对第三方模型的处理完全不一样：

- `/model gpt`（第三方）→ body.model 原样发 `"gpt"`
- `/model opus`（Anthropic 自家）→ 从二进制硬编码表里查到 `opus` → `claude-opus-4-7`，**body.model 发 `claude-opus-4-7`**（Claude Code 内部只认这三个裸 ID：`claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`）

所以如果你 `ALIAS_MAP` 里写的是 `"opus": "..."`，CCR 收到的 `body.model` 其实是 `claude-opus-4-7`——查不到，返回 `null`，回落到 `config.json` 的默认 Router。

更坑的是：Anthropic 家 haiku/sonnet/opus 的短 ID 回落时，CCR 往往会把它归为"后台/轻量任务"，命中 `Router.background`。结果你 `/model haiku` 实际跑的是 `Router.background` 里配的那个模型（我的是 Sonnet）。第一次看到"怎么切了还是不对"的时候很难想到是键名对不上。

#### 顺便省一次切换：启动直连 OpenRouter 也能复用这套映射

我 `.zshrc` 里配了：

```bash
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-..."
export ANTHROPIC_MODEL="anthropic/claude-4.7-opus-20260416"
```

这样直接敲 `claude`（不走 CCR）时，Claude Code 把 `ANTHROPIC_MODEL` 原样写进 `body.model`，请求直发 OpenRouter。**但 body.model 是 `anthropic/claude-4.7-opus-20260416` 这个完整字符串**，不是 `claude-opus-4-7`。

然后我**也走 CCR** 的场景（`cc` alias = `ccr code`），启动时 body.model 又会变成 `claude-opus-4-7`（Claude Code 内部从 `ANTHROPIC_MODEL` 推断别名再展开）——两套字符串都可能出现在 `body.model` 里。

所以 `ALIAS_MAP` 最干净的做法是把**两种形态的 key 都列进去**：

```javascript
const ALIAS_MAP = {
  // /model opus 切换后 Claude Code 会展开成这个裸 ID
  "claude-opus-4-7":           "or,anthropic/claude-4.7-opus-20260416",
  "claude-sonnet-4-6":         "or,anthropic/claude-4.6-sonnet-20260217",
  "claude-haiku-4-5-20251001": "or,anthropic/claude-4.5-haiku-20251001",
  // 其他家短名就行
  "gpt": "or,openai/gpt-5.4-20260305",
  // ...
};
```

这样启动 claude 就是 Opus，`/model sonnet` 切过去也是 Sonnet，`/model haiku` 是 Haiku。**不需要启动一次再切一次**。

验证 CCR 跑起来：

```bash
ccr start                # 前台起
# 或者
ccr code                 # 用 CCR 作为后端启动 claude
```

`ccr code` 能跑通就说明 CCR → OpenRouter 的链路是通的。

---

### 3.2 装 cc-connect

```bash
npm i -g cc-connect
```

配置目录 `~/.cc-connect/`，核心是 `config.toml`：

```toml
data_dir = ""
language = "en"

[[projects]]
  name = "my-project"

  [projects.agent]
    type = "claudecode"
    [projects.agent.options]
      mode = "default"
      work_dir = "/Users/你"              # 和桌面端 ccr code 的 cwd 对齐，后面讲为什么
      router_url = "http://127.0.0.1:3456"  # 指向 CCR
      router_api_key = "dummy"              # ⚠️ 不能留空！后面讲为什么

  # ── 飞书
  [[projects.platforms]]
    type = "feishu"
    [projects.platforms.options]
      app_id = "cli_xxx"
      app_secret = "xxx"

  # ── Telegram
  [[projects.platforms]]
    type = "telegram"
    [projects.platforms.options]
      token = "xxx:yyy"           # @BotFather 建 bot 给你的
      allow_from = "你的TG数字ID" # 或 "*" 允许所有人，建议先宽后紧

[log]
  level = "info"

[speech]
  enabled = true
  provider = "groq"
  language = "zh"
  [speech.groq]
    api_key = "gsk_..."
    model = "whisper-large-v3"
```

#### 飞书 app_id / app_secret 怎么拿

1. 去 [飞书开放平台](https://open.feishu.cn/) 创建「企业自建应用」
2. 开启「机器人」能力
3. 权限里勾上「以应用身份发消息」、「读取用户发给机器人的消息」、「获取群组信息」等
4. 事件订阅**必须切到「长连接模式」**（cc-connect 用的就是 WebSocket），HTTP 回调模式会连不上
5. 把应用发布到版本，企业管理员通过
6. 凭据与基础信息页找 App ID / App Secret

#### Telegram token 怎么拿

1. 在 Telegram 找 `@BotFather`
2. `/newbot` → 起个名字 → 起个 username（必须 `_bot` 结尾）
3. BotFather 返回 `xxx:yyy` 格式的 token，就是 `token` 字段填的值
4. 先填 `allow_from = "*"` 跑通后，看 cc-connect 日志里的 `telegram: message from unauthorized user <数字>`，那个数字就是你的 TG user ID，再改回 `"你的数字ID"` 收紧权限

#### 验证前台跑通

```bash
cd ~/.cc-connect
cc-connect
```

两个平台都 `platform started` 就说明连上了。手机上发条消息试试。

---

### 3.3 装 ffmpeg（语音必需）

```bash
brew install ffmpeg
```

**踩坑**：`[speech] enabled = true` 配了也没用，cc-connect 需要 ffmpeg 把飞书/Telegram 发过来的 `ogg`/`oga` 转成 Groq 认的格式。报错长这样：

```text
Voice message requires ffmpeg for format conversion. Please install ffmpeg.
```

装完之后不用重启 cc-connect，下次收到语音就能转了（cc-connect 是 exec 调用 ffmpeg 的，PATH 里能找到就行）。

#### Groq Whisper API key 怎么拿

1. [console.groq.com](https://console.groq.com/) 注册
2. API Keys 页新建 key，`gsk_...` 开头
3. 免费额度足够日常用，模型用 `whisper-large-v3` 中文识别效果不错

---

### 3.4 改成 launchd 守护进程（开机自启）

前面是前台跑，关终端就挂了。正式用要装成守护：

```bash
cd ~/.cc-connect          # ⚠️ 必须在含 config.toml 的目录下跑，不能用 --config 参数
cc-connect daemon install
```

成功后：

```bash
cc-connect daemon status   # 查状态
cc-connect daemon logs -f  # 流式看日志
cc-connect daemon restart  # 改完 config.toml 后必须 restart 才生效
cc-connect daemon stop     # 停
cc-connect daemon uninstall # 卸载守护
```

`daemon restart` 会给主进程发 SIGTERM，cc-connect 自己会清理它 fork 的 claude 子进程，不用手动杀。

---

## 四、日常使用

### 4.1 切模型

**持久切换**（桌面 / 手机都能用）：

```text
/model opus      # 切 Claude Opus
/model gpt       # 切 GPT-5.4
/model gemini    # 切 Gemini 3.1 Pro
/model free      # 切免费模型
```

**一次性切换**（只这条走新模型）：

```text
gpt: 写个 Python 快排
gemini: 帮我 Google 一下最新的 React 19 文档
free: 随便聊聊天
```

### 4.2 cc-connect 内置命令

| 命令 | 作用 |
|---|---|
| `/list` | 列出当前 project 下所有 session |
| `/switch <N\|uuid前缀\|名字>` | 切换到某个 session（注意不是 `/resume`！）|
| `/new` | 开一个全新的 session |
| `/reset` | 重置当前 session |
| `/help` | 列出所有 bot 命令 |

**注意**：`/resume` 是 Claude Code 内置命令，在 cc-connect 里会被转发给 claude，但 claude 的 resume picker 是交互式的，IM 里用不了。**cc-connect 用的是 `/switch`**。

### 4.3 桌面端看手机 session（需要同 work_dir）

`config.toml` 里 `work_dir = "/Users/你"`，和桌面端 `ccr code` 默认在 home 目录跑对齐后，两边会共用 `~/.claude/projects/-Users-xtuul/` 下的 jsonl。

**但有个限制**：桌面端 `/resume` 的 picker **看不到 cc-connect 起的 session**，因为 cc-connect 写的 jsonl 缺了几个字段（`permission-mode` / `file-history-snapshot` / `last-prompt`），picker 会过滤掉。

**曲线方案**：用 UUID 直接 resume

```bash
# 找最新的手机 session
ls -lt ~/.claude/projects/-Users-xtuul/*.jsonl | head -5

# 拿到文件名里的 UUID 前缀
ccr code --resume <uuid-prefix>
```

如果你常 resume，包两个 shell 函数（列最近 session、按 UUID 前缀 resume）会更丝滑，但不是刚需——靠肉眼挑最新那个 jsonl 文件 → `ccr code --resume <前 8 位>` 也能用。这块我自己还没打磨到想写进 `.zshrc` 的程度，以后单独写一篇。

### 4.4 桌面启动 alias

```zsh
# ── 常用：直接启动（权限全放行，适合完全信任的环境）
alias cc='ccr code --allow-dangerously-skip-permissions'

# ── 启动时直接指定模型（省一次 /model 切换）
alias cc-opus='ccr code --allow-dangerously-skip-permissions --model claude-opus-4-7'
alias cc-sonnet='ccr code --allow-dangerously-skip-permissions --model claude-sonnet-4-6'
alias cc-haiku='ccr code --allow-dangerously-skip-permissions --model claude-haiku-4-5-20251001'
alias cc-gpt='ccr code --allow-dangerously-skip-permissions --model gpt'
alias cc-codex='ccr code --allow-dangerously-skip-permissions --model codex'
alias cc-gemini='ccr code --allow-dangerously-skip-permissions --model gemini'
alias cc-qwen='ccr code --allow-dangerously-skip-permissions --model qwen'
alias cc-free='ccr code --allow-dangerously-skip-permissions --model free'
alias cc-nvidia='ccr code --allow-dangerously-skip-permissions --model nvidia'

# ── 重启守护 / 路由
alias ccc-restart='cc-connect daemon restart'
alias ccr-restart='ccr restart'
```

`--model <alias>` 传的就是 ALIAS_MAP 的键——Anthropic 系列要用完整 ID（`claude-opus-4-7` 这种），其他家用短名（`gpt` / `gemini` 等）。这样敲 `cc-opus` 启动直接就是 Opus 4.7，省一次 `/model` 切换。

---

## 五、踩坑全记录

按被坑顺序排。

### 坑 1：`gpt is not a valid model ID`

**现象**：在 claude 里 `/model gpt`，回 `Model may not exist`。

**原因**：cc-connect 没把请求转到 CCR，直接原样发给 Anthropic API，Anthropic 当然不认识 `gpt` 这个模型。

**根因**：`config.toml` 没配 `router_url`。

**修复**：

```toml
[projects.agent.options]
  router_url = "http://127.0.0.1:3456"
```

cc-connect 会自动给 claude 子进程设 `ANTHROPIC_BASE_URL=<router_url>` 和 `NO_PROXY=127.0.0.1`。

### 坑 2：`/login is not a cc-connect command` / `/login isn't available in this environment`

**现象**：手机发消息，bot 回「Not logged in · Please run /login」；发 `/login` 又回「isn't available」。

**原因**：claude 子进程启动时发现没 `ANTHROPIC_API_KEY`，进了登录流程。`/login` 是交互式命令，IM 里跑不了。

**根因**：`config.toml` 里 `router_api_key` 留空了（或注释掉了）。

**关键点**：`router_api_key` 有**双重作用**：

1. 如果 CCR 开了 APIKEY 校验，这个值要对上
2. **cc-connect 会把它当作 `ANTHROPIC_API_KEY` 注入给 claude 子进程** —— 空值时就不注入 → claude 找不到 key → 弹登录

**修复**：哪怕 CCR 没开校验，也要填个 dummy：

```toml
router_api_key = "dummy"
```

### 坑 3：`Voice message requires ffmpeg for format conversion`

**现象**：发语音消息，bot 回 ffmpeg 报错。

**原因**：`[speech] enabled = true` 只是打开语音识别的开关，转码还是要本地的 ffmpeg。

**修复**：`brew install ffmpeg`。

### 坑 4：`config.toml not found in /Users/xtuul`

**现象**：`cc-connect daemon install` 在任意目录跑，报 config 找不到。

**原因**：`daemon install` 固定从 **CWD** 找 `config.toml`，不是从 `~/.cc-connect/`。

**修复**：

```bash
cd ~/.cc-connect && cc-connect daemon install
```

**不要用 `cc-connect --config ~/.cc-connect/config.toml daemon install`**—— `--config` 参数会让它直接切成**前台运行模式**，不会安装守护。

### 坑 5：`cc-connect deamon restart`（打错字）→ Telegram getUpdates 冲突

**现象**：`deamon`（少一个 `a`），执行后终端开始刷日志：

```text
Conflict: terminated by other getUpdates request
Failed to get updates, retrying in 3 seconds...
```

**原因**：cc-connect 不认识 `deamon` 这个子命令，**静默回落到前台运行**。这时：

```text
launchd 管的 daemon     ← 在连 Telegram
         +
你前台新起的 cc-connect ← 也在连 Telegram
         ↓
    两个都 getUpdates，Telegram API 只允许一个长轮询
```

**修复**：

1. `Ctrl+C` 掐掉前台的
2. `cc-connect daemon status` 确认 daemon 还在
3. 正确拼写 `cc-connect daemon restart`

### 坑 6：`launchctl bootstrap failed: 5: Input/output error`

**现象**：`cc-connect daemon restart` 报这个。

**原因**：launchd 的老毛病，有时候 bootstrap/bootout 之间的状态不同步。

**修复**：拆成两步

```bash
cc-connect daemon stop
sleep 2
cc-connect daemon start
```

### 坑 7：daemon 模式下环境变量不生效（MCP / API key）

**现象**：`.zshrc` 里 `export FOO_API_KEY=...`，桌面端能用，daemon 跑的 cc-connect 里调 MCP 或用这个 key 的 subagent 就 401。

**原因**：Unix 进程环境变量的继承链：

```text
shell (读 .zshrc) → 你手动启动的程序       ✅ 拿得到
launchd (不读任何 shell 配置) → daemon      ❌ 拿不到
```

launchd 启动的守护进程环境是**空的**（只有 `HOME`、`PATH` 等几个基础变量）。`.zshrc` / `.bashrc` / `.profile` 它统统不读。

**修复**（三选一）：

| 方案 | 优点 | 缺点 |
|---|---|---|
| 直接写死在 `~/.claude.json` 的 MCP `headers` / `env` 里 | 最简单，key 跟着配置走 | 明文存文件里 |
| `launchctl setenv FOO_API_KEY ...` | 不用改配置 | 污染全局 launchd，机器重启失效 |
| 用前台模式跑 cc-connect | env 继承最干净 | 关终端就挂，要自己做 tmux/screen |

我自己选方案 1，`~/.claude.json` 里 MCP 的 key 直接写死。权限范围窄的 key（比如某个 MCP 专用的 API key）blast radius 有限，明文在本地 `.json` 可以接受。

### 坑 8：`/resume` picker 看不到 cc-connect 起的 session

**现象**：桌面端 `ccr code` 然后 `/resume`，picker 显示 `No conversations found`，即便 cc-connect 在同一个 `work_dir` 下已经写了几十条 jsonl。

**原因**：Claude Code 的 resume picker 会过滤 jsonl，要求有 `permission-mode` / `file-history-snapshot` / `last-prompt` 这几个 marker 字段。cc-connect 写的 jsonl 没这些字段（因为它走的是 stdin/stdout 协议，不是 TUI 启动路径）。

**协议不对称**：cc-connect 的 session 桌面端**能读**（`ccr code --resume <uuid>` 直接用 UUID 指定就行），但**不能列在 picker 里**。

**绕路方案**：

- `ccr code --resume <uuid>` 直接指定 UUID（见 §4.3 的 `ccrr` 函数）
- 或者在手机 cc-connect 里用 `/list` + `/switch` 切

### 坑 9：`/switch` 还是 `/resume`？

**cc-connect 用的是 `/switch`。**

`/resume` 会被转发给 claude，但 claude 的 resume 是 TUI 交互（弹选择器），在 IM 里跑不了。

```text
/list              ← 列 session
/switch 3          ← 按列表序号切
/switch e255dc42   ← 按 UUID 前缀切
/switch 工作讨论    ← 按 session 名字切（如果你设了）
```

### 坑 10：Stitch 装的时候 `No authenticated account found after setup`

**现象**：跑 `npx @_davideast/stitch-mcp init`，走到 OAuth 那一步，页面跳 Google 登录成功回来，但命令行里报 「No authenticated account found」。

**原因**：那个 init 脚本的 OAuth 流程需要你**另开一个终端**，手动跑：

```bash
gcloud auth login
gcloud auth application-default login
```

完了回原终端按回车。很多人以为浏览器登录完就结束了，其实 gcloud CLI 那头还没存凭证。

**更简单的办法**：别用 `npx stitch-mcp init`，直接在 `~/.claude.json` 里配 HTTP MCP，见 §3.5。这样不用 gcloud、不用装 Google Cloud SDK，一步到位。

如果你已经跑过 `npx` 那条路，清理一下：

```bash
rm -rf ~/.stitch-mcp
rm -rf ~/.config/gcloud    # 只在你之前没用 gcloud 时这么干！
rm -rf ~/.npm/_npx/*        # 清 npx 缓存
```

### 坑 11：`longContextThreshold` 是 sticky 的吗？

**误解**：「一旦某次请求超了阈值切到 longContext 模型，之后整个 session 都用这个模型」。

**真相**：CCR 是**无状态 / 每条请求独立路由**的。这次请求 input tokens 15万 → 走 longContext；下一条请求只有 3千 tokens → 回到 default。

`longContextThreshold` 说的是**这次请求发给模型的 input tokens**（包括 system prompt + 历史 + 当前消息），不是整个上下文窗口。

对 2026 年的 1M 窗口模型来说，阈值可以开大一点（比如 120k），没必要一超 20k 就换模型。

### 坑 12：`image` 路由选什么模型？

**误解**：`google/gemini-3.1-flash-image-preview` 是专门处理图片的，肯定最好。

**真相**：带 `flash-image` 或 `imagen` 字样的是**生成模型**（文字→图片），不是**分析模型**（图片→文字）。你在 claude 里贴图片问它「这张图什么意思」是要分析模型。

正确选择（按强弱）：

- `anthropic/claude-4.7-opus-20260416` ← 最均衡
- `anthropic/claude-4.6-sonnet-20260217` ← 便宜一档
- `openai/gpt-5.4-20260305`
- `google/gemini-3.1-pro-preview-20260219`

### 坑 13：飞书事件订阅模式选错

**现象**：飞书 app_id / app_secret 都对，cc-connect 起来了，但发消息没反应。

**排查**：cc-connect 日志里看有没有 `feishu: bot identified`。

**原因**：飞书开发者后台「事件与回调」那边要选**长连接模式**（WebSocket），不能选 HTTP 回调（那个需要公网 URL + 白名单 IP）。

---

## 六、日常运维 cheatsheet

```bash
# 状态
cc-connect daemon status

# 日志（持续）
cc-connect daemon logs -f
# 或
tail -f ~/.cc-connect/logs/cc-connect.log

# 改完 config.toml
cc-connect daemon restart
# 失败的话
cc-connect daemon stop && sleep 2 && cc-connect daemon start

# 找卡死的 claude 子进程
pgrep -fa "claude.*cc-connect, a bridge"

# 极端情况强杀
pgrep -f "claude.*cc-connect, a bridge" | xargs kill -9
cc-connect daemon restart

# CCR
ccr start              # 前台跑 CCR
ccr restart            # 重启 CCR（配置改完后用）
ccr code               # 用 CCR 启动桌面端 claude
ccr code --resume <uuid-prefix>  # 按 UUID 恢复 session
ccr code --model <alias>         # 启动时直接指定模型

# 快捷重启
ccc-restart            # = cc-connect daemon restart
ccr-restart            # = ccr restart

# OpenRouter 余额
curl -H "Authorization: Bearer sk-or-v1-..." https://openrouter.ai/api/v1/auth/key | jq
```

---

## 七、几个值得提的设计哲学

1. **分层的路由**：cc-connect（协议层）/ claude（agent 层）/ CCR（路由层）/ OpenRouter（聚合层）。每一层只做自己的事，出问题能精确定位。

2. **无状态的模型切换**：CCR 的 Router 是**每个请求独立决策**的，`longContextThreshold` 不是 sticky 的。想要 sticky 就用 `/model <alias>`（让 claude 每次都把这个 model 字段发过来）。

3. **session 互通但 picker 不互通**：底层 jsonl 文件是共享的（靠 `work_dir` 对齐），但各自的 UI 读 jsonl 时有自己的过滤规则。接受这个现实，用 `/list` + `/switch` + `ccr code --resume <uuid>` 绕过。

4. **launchd ≠ shell**：守护进程的 env 是一张白纸。配置敏感信息要么写死在 json/toml，要么走 `launchctl setenv`，不要指望 `.zshrc`。

5. **OpenRouter 分账号跑免费模型**：主账号付费 key（我叫 `or`）跑付费模型，另起一个 `or1` provider 专门跑 `:free` 模型。这样 rate limit 不打架，配额也清晰。

---

## 八、结语

这套东西跑通之后，日常使用体验是：

- 地铁上想起个 bug，掏手机飞书对 bot 说一句 `gpt: 帮我看下 xxx.py 的 rate limit 逻辑`
- 它在你家台式机上实际跑（用你家的 OpenRouter 配额、家里机器上所有已装好的工具链）
- 晚上回家敲 `cc-opus` 继续，手机上那个 session 用 UUID 一条命令恢复
- 语音输入 → Groq Whisper 转文字 → 一样跑

总体时间成本：从零到跑通大概一个下午，踩过上面 13 个坑之后会很顺。

完。

---

*本文基于 2026/04 时点的 cc-connect、claude-code-router、Claude Code 版本整理。未来版本可能会修掉其中一些坑（尤其是 resume picker 不认 cc-connect session、router_api_key 必须非空这类），但架构层面的东西应该不会变。*
