---
author: Xtuul
pubDatetime: 2026-04-28T18:27:41+08:00
title: "Claude Code 模型切换与 CCR 路由：踩坑全记录"
slug: claude-code-model-routing-analysis
featured: false
draft: false
tags:
  - claude
  - ccr
  - devtools
description: 记录在 Claude Code + CCR 环境下 /model 切换的两个关键问题：Haiku 路由命中错规则，以及官方内置别名 vs 三方 model ID 的能力差异。
---

这篇是两个调试 session 的踩坑记录，讲清楚三件事：为什么 CCR 的 `/model haiku` 路由不生效、为什么走 OpenRouter 用 Claude 内置别名比三方 model ID 好、以及官方通道独有什么。

## 目录

- [问题一：/model haiku 没走 ALIAS_MAP](#问题一model-haiku-没走-alias_map)
- [问题二：直接 claude 启动为什么 /model 还能切换](#问题二直接-claude-启动为什么-model-还能切换)
- [问题三：内置别名 vs 三方 model ID 差在哪里](#问题三内置别名-vs-三方-model-id-差在哪里)
- [跨 Provider 切换的隐形地雷：thinking block 签名污染](#跨-provider-切换的隐形地雷thinking-block-签名污染)
- [官方独有功能清单](#官方独有功能清单)
- [小结](#小结)

---

## 问题一：/model haiku 没走 ALIAS_MAP

现象：CCR 里配了 Haiku 路由规则，`/model haiku` 切换后却命中了 background 规则，实际跑的是 **Sonnet 4.6**。

### 排查过程

在 `router.js` 里看到的配置是：

```js
"claude-haiku-4-5": "or,anthropic/claude-4.5-haiku-20251001",
```

而 Claude Code 实际发给 CCR 的 HTTP 请求里，`body.model` 的值是：

```
claude-haiku-4-5-20251001
```

多了 `-20251001` 日期后缀。`ALIAS_MAP["claude-haiku-4-5-20251001"]` → `undefined` → router 返回 `null` → 回落到默认规则。

CCR 内置了一条判断：haiku 主要是 Claude Code 的 background 任务模型，所以 fallback 路由命中的是：

```js
"background": "or,anthropic/claude-4.6-sonnet-20260217"
```

最终用的是 Sonnet 4.6，不是 Haiku。

### 还有第二个 bug

即使 key 补全了，value 里也有问题：

```js
"claude-haiku-4-5": "or,anthropic/claude-4.5-haiku-20251001"
//                                          ^^^
//                           模型名写成了 4.5，实际应为 4.5-haiku
//                           且这个 slug 不在 or.models 白名单里
```

OpenRouter 侧如果 model 不在白名单里会直接拒掉，所以 key 即使匹配上了也会报 404。

### 修法

ALIAS_MAP 里的 key 必须和 Claude Code 发出的 `body.model` 完全一致。先用日志拦一条请求确认真实值，再写配置，不要靠推测。Sonnet 和 Opus 同样要校验：

```js
// 正确写法（以当前版本为例）
"claude-opus-4-7":           "or,anthropic/claude-4.7-opus-20260416",
"claude-sonnet-4-6":         "or,anthropic/claude-4.6-sonnet-20260217",
"claude-haiku-4-5-20251001": "or,anthropic/claude-haiku-4-5",
```

同时把 `claude-haiku-4-5` 加入 `config.json` 的 `or.models` 白名单，否则 OpenRouter 还是会拒。

---

## 问题二：直接 claude 启动为什么 /model 还能切换

这是另一个 session 里发现的事，起因是这个启动画面：

```text
▐▛███▜▌   Claude Code v2.1.121
▝▜█████▛▘  Opus 4.7 · API Usage Billing
  ▘▘ ▝▝    /Users/xtuul
```

直接 `claude` 启动（不是 `ccr code`），执行 `/model opus` 后，下一条消息正常用了 Opus 4.7。"这不是应该没走 CCR 就无法路由吗？"

### 关键：ANTHROPIC_BASE_URL 指向 OpenRouter

`~/.zshrc` 里设了：

```sh
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-..."
export ANTHROPIC_MODEL="anthropic/claude-4.7-opus-20260416"
```

Claude Code 直接读这三个变量，绕过 CCR 但**不直连 `api.anthropic.com`**，请求打到了 OpenRouter。

实际调用链：

```text
你 → claude (v2.1.121)
       ① 读 ANTHROPIC_BASE_URL → https://openrouter.ai/api
       ② 读 ANTHROPIC_AUTH_TOKEN → Authorization: Bearer sk-or-v1-...
       ③ /model opus → 会话状态设为 opus，写 settings.json
       ④ 发请求时把 opus 展开为 claude-opus-4-7
     ↓
POST https://openrouter.ai/api/v1/messages
body: { "model": "claude-opus-4-7", ... }
     ↓
OpenRouter（实现了 Anthropic Messages API 协议）
     ↓
Anthropic 原厂 API
```

`/model opus` 只做两件事：改会话状态、持久化到 `settings.json`。endpoint 和 token 由环境变量决定，和 `/model` 无关。

OpenRouter 的 `/v1/messages` 端点跟 Anthropic 协议兼容，所以 Claude Code 完全意识不到中间多了一跳。

### CCR vs 直挂 OpenRouter 的区别

| 场景 | 路径 | CCR 参与 |
|---|---|---|
| `ccr code` 启动 | claude → 127.0.0.1:3456 (CCR) → openrouter/其他 | ✅ |
| 直接 `claude` 启动（有 ANTHROPIC_BASE_URL） | claude → openrouter.ai 直连 | ❌ |

CCR 只在你需要更复杂的路由时才必要：多 provider 别名切换、按 model 改写请求体、剥 Claude 专属字段给其他厂商等。对"我就是要用 Anthropic 模型"这种场景，环境变量直挂就够。

---

## 问题三：内置别名 vs 三方 model ID 差在哪里

同一次 session 里做了一个实验，贴出两次 `/context` 的输出：

**用 `ANTHROPIC_MODEL=anthropic/claude-4.7-opus-20260416` 时：**

```text
⛁ ⛁ ⛁ ⛀ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   anthropic/claude-4.7-opus-20260416
                           39.6k/200k tokens (20%)
```

**切换 `/model opus` 之后：**

```text
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛀ ⛁ ⛁ ⛁ ⛁ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   Opus 4.7
                                                   claude-opus-4-7
                                                   63.6k/1m tokens (6%)
```

**同一个 Opus 4.7，上下文窗口差了 5 倍（200k vs 1M）。**

### 为什么会这样

Claude Code 二进制里硬编码了一张 model 能力表，从 binary strings 里能找到：

```text
model="claude-opus-4-7"
model="claude-sonnet-4-6"
model="claude-haiku-4-5"
// 以及 if(H!=="claude-opus-4-7") 这类硬编码分支判断
```

只有这三个**裸 ID**（不带厂商前缀，不带日期后缀）命中这张表。命中了，Claude Code 才会：

- 带上 `anthropic-beta: context-1m-...` header（解锁 1M context）
- 发送 `thinking: { type: "enabled", budget_tokens: ... }` 参数（开启 extended thinking）
- 查表设对 `max_tokens` 上限（opus 32k / sonnet 8k / haiku 8k）
- 按模型单价算 cache 定价，`/cost` 才能显示准确

遇到 `anthropic/claude-4.7-opus-20260416` 这种带前缀带后缀的 ID，表里查不到，全部按保守值处理。

### /model 切换的优先级

- **启动时**：读 `ANTHROPIC_MODEL` 作为初始值，原样进入会话状态，不做 allowlist 校验
- **执行 `/model opus` 后**：覆盖会话状态，写 `settings.json`，后续请求发 `claude-opus-4-7`
- 此时 `ANTHROPIC_MODEL` 完全被忽略

两种 ID OpenRouter 都能接（它对裸 claude id 会自动补 `anthropic/` 前缀），但 Claude Code 侧的能力开关只认裸 ID。

### 如果把 ANTHROPIC_MODEL 换成非 Claude 模型

比如 `openai/gpt-5.4-20260305` 或 `qwen/qwen3.6-plus-04-02`：

启动时能用，但有几个硬伤：

| 问题 | 原因 |
|---|---|
| `/model opus` 一按，立刻切回 Claude | 硬编码别名表里只有 Claude |
| Prompt caching 不生效 | `cache_control` 字段 GPT/Qwen 不认，直接丢弃 |
| Extended thinking 参数丢失 | 只有 Claude 4.x 支持，转发给别家时被过滤掉 |
| Tool use 结构错乱 | Anthropic 的 `tool_use/tool_result` block 翻译成 OpenAI `tool_calls` 时会丢 `id` 关联 |
| 系统 prompt 错乱 | CC 的 system prompt 是为 Claude 写的（"你是 Anthropic 的 CLI"等），GPT/Qwen 读到会输出奇怪内容 |

**这恰好解释了 CCR 存在的价值**：CCR 是专门处理这些场景的中间层：

```text
claude（只会发 claude-opus-4-7）
  ↓
CCR :3456
  ↓  ① 改写 model: claude-opus-4-7 → openai/gpt-5.4-...
     ② 剥掉 cache_control / thinking 字段，不让它们透传给不认识的 provider
     ③ 支持 glm: / qwen: 前缀做会话内一次性切换
     ④ 注册自定义别名表，/model <alias> 可以映射到任意 provider
  ↓
OpenRouter / 其他厂商
```

---

## 跨 Provider 切换的隐形地雷：thinking block 签名污染

在同一个 session 里，把 `ANTHROPIC_MODEL` 换成 DeepSeek 试了一次，随后切回 Claude，报了这个错：

```text
messages.11.content.0: Invalid `signature` in `thinking` block
provider_name: Anthropic
```

而且同一条 `messages.11` 被所有后续请求反复报错：

```text
req_011CaVYB... messages.11.content.0
req_011CaVYD... messages.11.content.0
req_011CaVYJ... messages.11.content.0
req_011CaVYK... messages.11.content.0
```

### 机制

Claude 4.x 在开启 extended thinking 时，响应里会有：

```json
{
  "type": "thinking",
  "thinking": "...思考摘要...",
  "signature": "abc123...HMAC签名"
}
```

`signature` 是 Anthropic 服务端用私钥签发的 HMAC。多轮对话时，客户端必须把历史里的 thinking block **原样**（含 signature）回传，Anthropic 后端会验签。

**切到 DeepSeek 时发生了什么：**

1. Claude Code 把带 thinking block 的历史原样打包，POST 给 OpenRouter，目标改成 `deepseek/deepseek-v3.2-...`
2. OpenRouter 翻译成 DeepSeek API 格式，调 DeepSeek，得到响应
3. OpenRouter 把 DeepSeek 的响应翻译回 Anthropic 格式，**伪造了一个 thinking block**（塞了个占位 signature）
4. Claude Code 把这个"伪 thinking block"写进会话 history

**切回 Claude 时：** 包含伪 thinking block 的完整 history POST 到 Anthropic 原厂 → 验签失败 → 400。

Qwen 能继续用，因为 Qwen 后端不在乎 signature，OpenRouter 转过去时直接把 thinking block 丢掉。但只要目标是 Anthropic 原厂，`messages.11` 那个坏掉的 block 就会一直触发同一个错误。

### 修复

只能清掉那条消息才能恢复：

```bash
# 在 Claude Code 里执行
/clear
```

清完历史之后切回 `/model opus` 就正常了。

### 为什么 CCR 不会出现这个 bug

CCR 的 transformer 出站前会扫描 history，根据目标 provider 决定保留还是剥离 thinking block：

```js
// CCR 伪代码
if (targetProvider !== 'anthropic') {
    stripThinkingBlocks(messages);
} else {
    stripForeignThinkingBlocks(messages); // 目标是 Claude 但历史里有外来 block，也剥掉
}
```

直挂环境变量走 OpenRouter 没有这层保护，Claude Code 发什么 OpenRouter 就原样转什么。

---

## 官方独有功能清单

这部分是 session 里顺带搜出来的，列几个有硬证据的。

### Auto 模式（任务复杂度自动切换 Opus/Sonnet/Haiku）

- 需要 **Max 订阅 + `/login` 登录 + 环境里没有 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`**
- 是 Anthropic 服务端 feature flag 控制的订阅特性，按账号灰度放开
- GitHub issue #46616 里明确写了触发条件：一旦检测到 API key 类环境变量，Auto 模式直接禁用

只要你用了 OpenRouter（需要设 `ANTHROPIC_AUTH_TOKEN`），Auto 模式就永远用不了。

### Prompt Caching 命中率

多个独立报告显示，走 OpenRouter 的 Claude 请求，prompt cache 效果明显不如直连：

- `opencode #1245`：OpenRouter 下 cache 只对 system message 生效
- `Zed #52576`：`native_tokens_cached` 始终是 0，形同关闭
- SillyTavern 讨论：1 小时 TTL 在 OpenRouter 任何 Anthropic provider 下都不工作
- `ai-sdk-provider #35`：prompt caching 完全没命中，长期未修

### 1M Context 的计费入口

OpenRouter 路径下，即使你用了内置别名解锁了 1M context，如果 Anthropic 侧需要额外收费，报错如下：

```text
API Error: Extra usage is required for 1M context
run /extra-usage to enable, or /model to switch to standard context
```

`/extra-usage` 这个命令在官方订阅通道才有对应入口，OpenRouter 路径没有。

### 其他官方独占

| 能力 | 官方现状 | 三方现状 |
|---|---|---|
| Auto 模式 | Max 订阅 + Opus 4.7 | 无 |
| 2026-04-04 起 Pro/Max 订阅额度 | 官方独用 | 第三方 harness 不能消耗订阅 quota |
| Extended thinking 签名完整性 | 原生签发+验签 | 跨 provider 切换会污染 history |
| `/fast` 的 Opus 4.6 Fast 变体 | 有 | OpenRouter 的 model 列表里没有这个变体 |
| Files API / Code Execution | 官方 beta endpoint | OpenRouter 不转发非 `/v1/messages` endpoint |
| Managed Agents / Remote Trigger | 官方 API | 无 |
| Claude Code 的 session 同步 | CLI/桌面/Web 互通 | 只能本地 CLI |
| 新模型首发 | 发布当天可用 | 通常延迟几小时到几天 |

另一个硬事实：2026-04-04 Anthropic 封锁了第三方 agentic 工具消耗 Pro/Max 订阅 quota，原话是"usage will be billed to your API account"。加上 Claude Code 本身在 2026-04-21 从 Pro 计划里被移除（仅 Max 5x+ 保留），订阅价值已经集中在 Max 路径。

---

## 小结

三件事的结论：

1. **CCR ALIAS_MAP**：key 必须与 Claude Code 发出的 `body.model` 完全一致，带日期后缀。先抓一条请求日志确认真实值，再写配置。
2. **内置别名 vs 三方 ID**：走 OpenRouter 时，用 `/model opus` 而不是 `ANTHROPIC_MODEL=anthropic/claude-4.7-opus-20260416`，能多拿到 1M context、extended thinking 参数、正确的 max_tokens 和 cache 定价，差距显著。
3. **跨 provider 混用会话**：遇到 thinking block 就是定时炸弹。直挂 OpenRouter 没有 CCR 那层 transformer 保护，切到非 Anthropic provider 再切回来，只能 `/clear` 重来。
