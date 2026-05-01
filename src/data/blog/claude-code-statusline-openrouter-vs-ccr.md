---
author: Xtuul
pubDatetime: 2026-05-01T17:25:00+08:00
title: "Claude Code 状态栏统一布局，两条数据链路：OpenRouter 直连 vs CCR 代理"
slug: claude-code-statusline-openrouter-vs-ccr
featured: false
draft: false
tags:
  - claude
  - claude-code
  - ccr
  - devtools
description: 给 Claude Code 做了一套四行树形状态栏，一份给 bare claude 走 OpenRouter，一份给 ccr code 走本地代理。记录颜色、图标、进度条的打磨过程，以及两条链路数据源差异带来的坑。
---

这篇是给 [claude-statusline](https://github.com/lizhaopeng-cn/claude-statusline) 仓库做的一次完整迭代记录。同一套视觉语言，两个脚本实现，分别服务 bare `claude` 和 `ccr code` 两条启动路径。重点不是"怎么写一个状态栏"，而是**为什么需要两个脚本**，以及它们各自拿得到什么、拿不到什么。

## 目录

- [两个脚本的职责分工](#两个脚本的职责分工)
- [四行布局定稿](#四行布局定稿)
- [颜色表：从过度到精简](#颜色表从过度到精简)
- [进度条：从 `█░` 到 `▉░`](#进度条从--到-)
- [tokens 分母差 5 倍：contextWindowSize 不是真相](#tokens-分母差-5-倍contextwindowsize-不是真相)
- [cost 也有三层真相：CCR 估算 / OpenRouter 真实 / key 总额](#cost-也有三层真相ccr-估算--openrouter-真实--key-总额)
- [踩过的坑](#踩过的坑)
- [小结](#小结)

## 两个脚本的职责分工

仓库里两个脚本，不是一主一备，**是两条完全独立的数据链路**：

| 启动方式 | 谁渲染状态栏 | 配置来源 | 输入 |
|---|---|---|---|
| `claude`（直连 OpenRouter） | `statusline.ts` | `~/.claude/settings.json` → `statusLine.command` | stdin JSON |
| `ccr code`（走本地 CCR 代理） | `ccr-append.js` | `~/.claude-code-router/config.json` → `StatusLine.modules` | CCR `variables` 对象 |

Claude Code 有一个"内置 statusLine"机制：会把一个 JSON 写到指定命令的 stdin，读它的 stdout 当状态栏内容。`statusline.ts` 就是这个命令。

CCR 自己也有一套 statusLine 渲染（写在 CCR 配置里），完全不走 CC 的 statusLine 管道。`ccr-append.js` 是通过 `module.exports = async (variables, options) => string` 被 CCR 调用的。

**所以同一台机器上这两个脚本是同时存在、互不干扰的**。切换启动方式，屏幕上显示的状态栏也切换成对应脚本的输出。

## 四行布局定稿

两个脚本最终输出的四行结构完全一致：

```text
L1  󰉋 claude-statusline  󰉋 main
L2  ├  󰚩 Amazon Bedrock: claude-opus-4-7
L3  ├  󰚩 $0.3821 ($-0.08)  $423.27 / $500
L4  └  󰉍 305.5k / 1.0M (31%)  ▉▉▉░░░░░░░
```

- **L1**：工作目录 + git 分支，无前缀（视觉锚点）
- **L2**：模型，前缀 `├`，含 provider 前缀（bare claude 独有，因为只有它能拿到 provider name）
- **L3**：花费与 key 预算，前缀 `├`，cache discount 用括号 + 删除线标记"省下来的钱"
- **L4**：上下文占用，前缀 `└`，附 10 格进度条

中间反复调整过顺序：

- 最早 `[模型][目录][分支]` 挤一行，显得喧闹
- 后来把"标识信息"（模型/目录/分支）拆成两行，目录在上、模型在下——目录是"我现在在哪里干活"的锚点，模型是"这个锚点当前绑定的能力"，符合人读状态栏从上往下扫的优先级

**图标选择**（都是 Nerd Font 单列宽）：

| 图标 | 码位 | 来源 | 用途 |
|---|---|---|---|
| `󰉋` | U+F024B | Font Awesome | workDir |
| `` | U+E725 | Devicon | git branch |
| `󰚩` | U+F06A9 | Material Design Icons | model |
| `` | U+F155 | Font Awesome | cost（代替 emoji `💰`） |
| `󰉍` | U+F024D | Font Awesome | tokens gauge |

emoji `💰` 占两列宽，Nerd Font 图标占一列宽。混用会让所有行的视觉纵对齐错位。早期版本用 `💰`，对齐强迫症犯了，整体替换成 Nerd Font dollar-sign。

## 颜色表：从过度到精简

一开始颜色键定义了 17 个，实际用到 10 个。最终精简后两个脚本用同一套：

```js
const C = {
  reset:           "\x1b[0m",
  dim:             "\x1b[2m",   // 树形符 ├ └
  green:           "\x1b[32m",  // 进度 ≤60%
  yellow:          "\x1b[33m",  // 进度 ≤80%
  red:             "\x1b[31m",  // 进度 >80%
  bright_blue:     "\x1b[94m",  // workDir
  bright_green:    "\x1b[92m",  // git branch
  bright_magenta:  "\x1b[95m",  // 预算分母 limit
  bright_cyan:     "\x1b[96m",  // 预算分子 usage
  bright_yellow:   "\x1b[93m",  // cost 金额
  bright_red:      "\x1b[91m",  // 󰚩 model 整段
};
```

**每个颜色都对应状态栏上一个具体元素**。没用到的键一律删掉——否则半年后回来读代码，会对着注释里写"此色备用"那种说法恶心半天。

色彩分配的核心判断：

- **花费 / 用量进度**走冷暖梯度（绿→黄→红），让人对"还剩多少钱/空间"有直觉
- **纯标识信息**（模型、目录、分支、预算上下限）各自用明确的颜色区分，但**同类用同色**（预算的分子永远 cyan、分母永远 magenta）
- **树形符** `├ └` 用 dim，退到背景里不抢戏

## 进度条：从 `█░` 到 `▉░`

进度条早期用 `█ + ░`：

```text
██████░░░░   60%
```

看着没问题，但相邻的 `██` 完全糊成一整条，失去"格子感"。

尝试过 [claude-hud](https://github.com/jarrodwatts/claude-hud) 那种"每格分隔"的风格，研究了一圈 Unicode 的 Block Elements：

- `█`（U+2588）：满格实心
- `▉`（U+2589）：**7/8 宽度实心** —— 留 1/8 空隙
- `▊▋▌▍▎▏`：依次递减到 1/8

最终选 `▉`（U+2589）：

```text
▉▉▉▉▉▉░░░░   60%
```

相邻 `▉▉` 之间天然有 1/8 的细缝，视觉上像 `claude-hud` 那种"独立格子"的效果，但**没有额外字符开销**（依然 10 格）。

右侧未填充部分保持 `░`（U+2591），是最稀的 shade 字符。考虑过 `▒`（中密度）和 `▓`（高密度），甚至 `░▓` 交替做"点阵感"，实测都不如单纯 `░` 干净。

**前景色染色**，不染背景——进度条的"状态"通过前景色（绿/黄/红）传达，背景保持终端默认，避免各种终端主题下背景色冲突。

## tokens 分母差 5 倍：contextWindowSize 不是真相

两条链路下 tokens 行有个讨厌的差异：

- bare claude：显示 `󰉍 147.6k / 1.0M (15%)`
- ccr code：显示 `󰉍 147.6k / 200.0k (74%)`

**同一 session、同一上下文**，一个 1M 窗口 15%，另一个 200k 窗口 74%。哪个对？

**是 1M 那个对**。根源：

- `statusline.ts` 从 CC stdin 的 `context_window.context_window_size` 拿窗口大小。CC 认识 canonical 模型名 `claude-opus-4-7`，查自己的模型表得到 1M
- `ccr-append.js` 从 CCR `variables.contextWindowSize` 拿。**CCR 不知道 OpenRouter `anthropic/claude-4.7-opus-20260416` 这个 ID 对应哪个窗口，只会传一个兜底的 `200k`**

这个差异不是代码 bug，是架构差异。CCR 能控制的只有"把请求转发给 OpenRouter"，它没义务维护"OpenRouter 的每个模型 ID 对应多少 token 窗口"这张表。

处理方式：**ccr-append.js 里对 `v.contextWindowSize` 做容错**，能解析的就用（`"1000k"` / `"1m"` 这类字符串），不能解析的用 200k 兜底。

```js
function parseNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const s = v.trim().replace(/[,\s%]/g, "").toLowerCase();
  const m = s.match(/^([+-]?\d*\.?\d+)\s*([kmb]?)$/);
  if (!m) return Number(s) || 0;
  const base = parseFloat(m[1]);
  const unit = m[2];
  if (unit === "k") return base * 1_000;
  if (unit === "m") return base * 1_000_000;
  if (unit === "b") return base * 1_000_000_000;
  return base;
}
```

本质上这个问题**从数据源就注定不一样**。ccr code 下状态栏的数字只能保证"跟 `/context` 面板一致"——因为两者共享同一份 CCR 认知。

## cost 也有三层真相：CCR 估算 / OpenRouter 真实 / key 总额

花费这行也有坑。同一个请求，三处数字通常都不一样：

| 来源 | 字段 | 语义 |
|---|---|---|
| CCR `variables.cost` | ccr-append 的 ` $67.07` | **CCR 用自己的定价表估算**，常偏高（没算 cache hit 折扣） |
| OpenRouter `/generation?id=X` | statusline 的 ` $50.1051` | **OpenRouter 真实扣费**，含 cache hit 折扣 |
| OpenRouter `/auth/key` | `or: $423.27 / $500` | **整个 key 的累计消耗 / 月限额** |

`ccr-append.js` 只有 CCR 的估算能拿到。想要 OpenRouter 真实花费就必须自己调 `/generation`，但那需要从 transcript 里抠 `gen-*` ID 做累加，是 statusline.ts 的套路。目前 ccr-append 没做这一层，维持"估算 + 预算"两个数字。

**cache discount 显示策略**：

```js
// statusline.ts L3
const costStr = `${C.bright_yellow} $${state.total_cost.toFixed(4)}${C.reset}` +
  ` \x1b[9m($${state.total_cache_discount.toFixed(2)})\x1b[29m`;
```

`\x1b[9m` 开删除线，`\x1b[29m` 关。`($67.08)` 被删除线划掉，语义就是"这部分钱本来要花、但省下来了"。大部分现代终端（iTerm2 / kitty / WezTerm / Ghostty）都支持；老版 Terminal.app 会忽略 SGR 9，但不会乱码。

## 踩过的坑

### 1. Nerd Font 图标的"两个点"是渲染问题

在 Claude Code CLI 里看我贴的图标经常显示成 `··`（两个点）或豆腐块。第一反应是"字体装错了"，折腾半天。后来发现 Claude Code **自己的聊天面板用的字体**跟终端不一定同一个，**而终端字体真装了 Nerd Font**。

判断方法：`printf '\n'` 直接在终端打印。**能看清字形 = 终端 OK**；看到的 `··` 只是 CC 聊天 UI 的字体限制。状态栏是脚本直接写到终端的，走终端字体，所以状态栏上的图标**一定能正确渲染**。

### 2. execSync 在 statusLine 脚本里要加 timeout

`ccr-append.js` 第一版调 git 取 branch 用了 `execSync("git rev-parse --abbrev-ref HEAD")`，在某些 cwd（比如 git 库损坏、.git 目录在被 VFS 锁）下会挂住整个脚本。statusLine 每秒都会调一次，挂一次状态栏就一秒不更新。

修法：`timeout: 500` + `fs.existsSync(cwd)` 双保险。

```js
function gitBranchSync(cwd) {
  try {
    if (!fs.existsSync(cwd)) return "";
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 500,
    });
    return (out || "").trim();
  } catch {
    return "";
  }
}
```

### 3. OpenRouter `/auth/key` 要缓存 20 秒

`ccr-append.js` 的右侧"预算行"（`or: $423 / $500`）是实时调 OpenRouter `/auth/key` 拿的。CC 每秒刷新 statusLine，如果每次都调一次 HTTP，几小时就会把 key 的 rate limit 打爆。

方案：`/tmp/ccr-budget-cache.json` 存最近一次查询结果，TTL 20 秒，过期才 re-fetch。整个会话下来 HTTP 调用量可控。

### 4. ccr code 冷启动时状态栏空白 ≠ 脚本失败

一开始以为是 `ccr-append.js` 在 CCR 刚启动时拿不到 `variables` 字段导致输出空串。打开 `DEBUG_DUMP` 之后发现**CCR 每次调用都传了完整的 variables**，脚本也确实输出了完整 4 行。

但屏幕上就是空白。

换个姿势验证：在 `statusline.ts` 开头加个 `[PROBE]` 前缀——重启 cc，屏幕依然空白。说明问题**不在脚本**，而在 **Claude Code 2.1.121 对多行 statusLine 的渲染**。这一代 CC 的 statusLine 渲染层（Ink 外包了 `<Text wrap="truncate">`）遇到 `\n` 会吞掉后续行甚至整块。冷启动时窗口宽度可能还没拿到，整段被判定为"overflow"，直接不渲染。

最终放弃修这个——CC 侧的行为不是脚本能控制的，启动几秒后第一次刷新就正常了，用户感知几乎没有。

## 小结

做状态栏脚本本以为是半小时的活，实际搞了好几天。收获两点：

1. **同一块屏幕上的数字，可能有完全不同的数据源**。CCR / OpenRouter / Claude Code 三方对"当前用了多少 token / 花了多少钱"各有各的账本，状态栏上并排显示的数字经常对不齐。不是 bug，是架构事实
2. **CLI 视觉细节的收益递减曲线很陡**。图标从 emoji 换到 Nerd Font 收益最大（对齐 + 单列宽），然后是颜色分层，最后进度条从 `█` 到 `▉` 收益已经不大，但对强迫症友好

仓库：[lizhaopeng-cn/claude-statusline](https://github.com/lizhaopeng-cn/claude-statusline)。需要的话拎走直接用。
