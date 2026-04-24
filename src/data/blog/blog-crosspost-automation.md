---
author: Xtuul
pubDatetime: 2026-04-24T19:50:10+08:00
title: "从零搭建个人技术博客 · 篇二：跨平台自动分发"
slug: blog-crosspost-automation
featured: false
draft: false
tags:
  - blog
  - automation
  - devops
description: push 到 main 就自动把文章同步到 dev.to / Hashnode / 博客园。写完才发现博客园从 GitHub Actions 打过去会被风控拦掉，于是这篇也顺便记录了：为什么最终国内平台全部放弃。
---

篇一是主站（`blog.xtuul.com`）本身的搭建，篇三是写作流（`/blog new` 这套 skill）。这一篇填篇二：**文章写完 push 上去之后，自动同步到其他平台**，不用我手动复制粘贴。

**本篇讲什么**：一个具体的 GitHub Actions + TypeScript 小工具，push 到 main 就把 `src/data/blog/*.md` 发到 dev.to、Hashnode、博客园，首发拿到平台 id，之后再推就是 update 而不是重发。

**本篇不讲什么**：具体某个平台的 API 怎么接（RTFM 的活），以及为什么最后**国内平台一个没留**。最后一节会单独讲这个。

## 目录

## 要解决的问题

主站在 Cloudflare Pages 上，但一篇文章想被人看到，光靠 Google 搜索和主站 RSS 远远不够。常见做法有三种：

1. **只在主站写**，其他平台空着——SEO 和流量都吃亏
2. **每篇写完手动复制粘贴到其他平台**——第 3 篇之后我就会放弃
3. **写完一次 push，代码自动同步**——这篇要做的事

关键约束：

- **主站是 canonical**：dev.to / Hashnode 都支持声明 `canonical_url`，明确告诉搜索引擎"原文在 blog.xtuul.com"，这样即使文章被多平台收录，SEO 权重也不会被稀释
- **幂等**：同一篇文章推两次不能变成两篇。要走"首发→拿到 id→以后用 id update"的路径
- **一个平台挂不阻塞别的**：博客园风控拦了不能让 dev.to 也发不出去

## 整体架构

先把地图画出来：

```text
┌───────────────────────────────────────────────────────────┐
│ 本地写作：/blog new → src/data/blog/<slug>.md             │
│                                                           │
│                    git push origin main                   │
│                            │                              │
└────────────────────────────┼──────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────┐
│ GitHub Actions: .github/workflows/syndicate.yml           │
│                                                           │
│   on.push.paths: [src/data/blog/**/*.md]                  │
│     │                                                     │
│     ▼                                                     │
│   pnpm dlx tsx scripts/crosspost/index.ts                 │
│     │                                                     │
│     │──► diff HEAD~1..HEAD 或 workflow_dispatch 入参     │
│     │──► 对每篇改动的 .md：                              │
│     │     ├─ load frontmatter                             │
│     │     ├─ if draft: skip                               │
│     │     ├─ for each platform (devto/hashnode/cnblogs): │
│     │     │    ├─ 已有 id → update                       │
│     │     │    └─ 无 id   → create, 拿 id+url           │
│     │     └─ 写回 frontmatter.crosspost.<platform>       │
│     └──► git add / commit / push [skip ci]               │
└───────────────────────────────────────────────────────────┘
```

代码都在 `scripts/crosspost/`：

```text
scripts/crosspost/
├── index.ts              # 入口，解析 diff，调度每个 publisher
├── lib/
│   ├── frontmatter.ts    # 手写的极简 YAML parse/stringify
│   └── types.ts          # Post / Publisher / PublishResult 接口
└── platforms/
    ├── devto.ts          # POST /api/articles
    ├── hashnode.ts       # GraphQL mutation publishPost / updatePost
    └── cnblogs.ts        # MetaWeblog XML-RPC
```

## 设计决定与权衡

### 1. 文件就是状态，没有外部数据库

frontmatter 里直接加一个 `crosspost` 字段：

```yaml
crosspost:
  devto:
    id: 3544836
    url: "https://dev.to/lizhaopengcn/xxx"
  hashnode:
    id: 69eb1b54bada4a44e9c589e2
    url: "https://xtuul.hashnode.dev/xxx"
```

第一次推文章：三个字段都不存在 → 脚本走 create → 拿到 id 和 url 写回 frontmatter → auto-commit 回 `main`。

第二次推同一篇：frontmatter 里已经有 id → 脚本走 update，不会产生重复文章。

**为什么不用 SQLite / KV**：这是个一人博客。加一个外部存储等于多一个要备份、要恢复、要对齐状态的东西。文章本身已经在 git 里了，id 就放旁边，**状态和内容原子地一起 commit**。

### 2. canonical URL 固定指向主站

每次发文章时都显式带 `canonical_url: https://blog.xtuul.com/posts/<slug>/`，哪怕主站还没上线那篇。

- dev.to：支持 `canonical_url` 字段，显示"Originally published at blog.xtuul.com"
- Hashnode：`originalArticleURL` 字段，行为一样
- 博客园：MetaWeblog 没 canonical 这个字段，只能在正文开头手动加一行"原文："（实际上最后没做，原因后面说）

### 3. 每个 publisher 实现同一个接口

```ts
export interface Publisher {
  name: "devto" | "hashnode" | "cnblogs";
  enabled: () => boolean;            // 环境变量齐了就 enable
  publish: (post: Post) => Promise<PublishResult>;
}
```

`index.ts` 不关心具体平台怎么调 API，只负责：挑出 enabled 的平台、串行跑、把 `PublishResult` 写回 frontmatter、最后 git commit。每加一个平台只要写一个新的 `platforms/<name>.ts`。

### 4. per-post 串行、per-platform 独立

一篇文章里三个平台**串行**发（dev.to → Hashnode → 博客园），每个都单独 try/catch。任意一个失败不阻塞其他平台，也不阻塞下一篇文章。所有结果最后统一打印。

```ts
for (const post of posts) {
  for (const platform of platforms) {
    try {
      const result = await platform.publish(post);
      writeback(post, result);
    } catch (err) {
      console.error(`✗ ${platform.name} ${action}: ${err.message}`);
    }
  }
}
```

## 踩过的坑

真写出来之后，前后一共掉坑里三次。记下来。

### 坑 1：Astro 的 `z.date()` 不接受带引号的 ISO 字符串

写完代码本地测试通过，push 到 main 之后 Cloudflare Pages **构建挂了**：

```text
pubDatetime: Expected type "date", received "string"
```

问题出在 "脚本回写 frontmatter" 这一步。Astro content collection 的 schema 里 `pubDatetime` 是 `z.date()`，它要求 YAML 里是**裸的 timestamp**，不能是字符串：

```yaml
# 这样 Astro 能识别为 Date
pubDatetime: 2026-04-24T19:50:10+08:00

# 这样 Astro 会当 string，schema 直接挂
pubDatetime: "2026-04-24T19:50:10+08:00"
```

我的 YAML stringify 函数 "遇到包含 `:` 或其他特殊字符的字符串就加引号"，ISO 时间戳正好命中。修法是**给日期类字段开白名单**，裸输出：

```ts
const DATETIME_KEYS = new Set(["pubDatetime", "modDatetime"]);

function emit(key, value) {
  if (DATETIME_KEYS.has(key) && typeof value === "string") {
    return `${key}: ${value}`;   // 不加引号
  }
  // ...其他走通用 stringify
}
```

这种"主站和同步脚本之间有个看不见的契约"的坑，**本地开发过程中完全不会碰到**，只有 push 之后 Cloudflare 那边才会炸。CI 流水线一定要**在两边都跑一次**才能发现。

### 坑 2：自己写的 YAML parser 不支持嵌套对象

上面那段 `crosspost.devto.id` 是嵌套两层的。一开始我图省事，手写了个 20 行的 YAML parser，只支持"key: value"和列表。结果第二次推文章时：

```text
✗ devto create: Canonical url has already been taken
✓ hashnode create → xxx-1-1     ← 注意 "-1-1"
```

脚本**没读到已有的 id**，当成全新文章再发了一遍。dev.to 靠 canonical 查重、直接 422 拒绝；但 **Hashnode 完全不查重**，默默给新文章一个 `-1`、`-1-1` 的递增 slug，看起来"发布成功"，**实际上我的博客上重复文章越堆越多**。

后来把 parser 换成支持递归缩进的版本，才读得出嵌套结构。**教训**：

1. 不要在状态机关上图省事自己造轮子。要省就**连嵌套都别用**（比如把 `crosspost_devto_id` 拍平成一级 key），要嵌套就用 `js-yaml`。
2. **"默默成功"比"显式失败"可怕得多**。Hashnode 这种接口设计等于在地雷区里埋了一个脸朝下的地雷。

### 坑 3：博客园把 GitHub Actions 的出站 IP 风控了

这是让我最后放弃国内平台的直接原因，值得单拎一节。

## 为什么最后没做国内平台

本来清单上是：**dev.to + Hashnode + 博客园**。三个平台的 API 都接好了、secret 也配好了、本地 dry-run 全过。推上去跑 workflow：

```text
✓ devto update → https://dev.to/...
✓ hashnode update → https://xtuul.hashnode.dev/...
✗ cnblogs create: HTTP 500 (empty body)
```

第一反应：鉴权有问题？XML-RPC 包错了？字段不全？

挨个验证：

1. **在本地跑 curl**，同样的 token、同样的 username、同样的 endpoint，打一条最小的 `metaWeblog.newPost` 过去。**200，返回 postid，完美**。
2. **在本地跑脚本**，用 `loadPost` 读真实文章、构造和 Actions 里字节级完全相同的 XML，再 curl 发出去。**又是 200，postid 正常返回**。
3. 回到 Actions，一模一样的代码、一模一样的 secret。**仍然 HTTP 500，body 空**。

排查逻辑很简单——如果鉴权或内容有问题，博客园会返回 `<fault>` 带具体 `faultString`；400、401、404 也都会有 body 说明原因。**500 + 空 body** 是非常特殊的组合：请求根本没到业务层，而是在前置的网关/WAF 上就被掐掉了。

`rpc.cnblogs.com` 的网关对 **Azure westus 的 IP 段**做了风控。GitHub Actions 的 runner 正好在那里。对 "Azure IP 对国内内容平台的出站连接" 这件事有过了解的人应该都见过类似剧情——十年来这类平台对海外云的 IP 越来越敏感。

**没有干净的解法**：

- 在 runner 上装代理 → 需要一台国内机器当出口，相当于给博客同步这件事凭空加一台要维护的 VPS，**零运维的前提破了**
- 换平台官方 SDK → 博客园官方 API 只有 MetaWeblog，没有别的公开协议
- 用 Puppeteer 模拟浏览器 → CI 里跑无头 Chrome 要装 100MB 依赖、要在 CI 内完成扫码/验证码，**越想越不值**
- 调研了一下其他国内平台（掘金、CSDN、SegmentFault）：要么同样的 IP 风控，要么没有公开 API，抓包出来的接口几个月就会变一次

我算了下账：

| 方案 | 搭建成本 | 维护成本 | 稳定性 |
|---|---|---|---|
| 加一台国内中转机 | 半天 | 每月续费 + 偶尔抢救 | 中 |
| Puppeteer 方案 | 2~3 天 | 平台前端一改就挂，每平台每季度至少修一次 | 中 |
| 浏览器插件（ArtiPub 之流） | 装一下 | 低（但**手动点击**，不算自动化） | 高但不自动 |
| **全部放弃国内平台** | 0 | 0 | — |

对一个个人博客来说，**我不做国内平台的"机会成本"** 是：国内读者来主站（或 dev.to / Hashnode 的英文版）的时候少看到一点入口。可以接受。

**继续做国内平台的"直接成本"** 是：一台新机器 or 一套会定期 rot 的 Puppeteer 代码。**不能接受**。

所以：

- `scripts/crosspost/platforms/cnblogs.ts` 代码留着，以后哪天有国内机器了直接改 endpoint 就能用
- workflow 里留着 `CNBLOGS_*` 的 secret 判断——没配就跳过，**什么都不会打印**
- 目前跑 workflow 只会看到 dev.to 和 Hashnode 成功

## 当前成品

### workflow 配置

`.github/workflows/syndicate.yml` 的骨架：

```yaml
name: Syndicate

on:
  push:
    branches: [main]
    paths:
      - "src/data/blog/**/*.md"
  workflow_dispatch:
    inputs:
      files:
        description: "要同步的文件路径（空格分隔），留空=diff"
        required: false

concurrency:
  group: syndicate
  cancel-in-progress: false

jobs:
  crosspost:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      # ... setup pnpm / node
      - run: pnpm dlx tsx scripts/crosspost/index.ts ${{ inputs.files }}
        env:
          DEVTO_API_KEY: ${{ secrets.DEVTO_API_KEY }}
          HASHNODE_API_KEY: ${{ secrets.HASHNODE_API_KEY }}
          HASHNODE_PUBLICATION_ID: ${{ secrets.HASHNODE_PUBLICATION_ID }}
          SITE_BASE: https://blog.xtuul.com/
      # ... auto-commit if frontmatter changed
```

关键点：

- `paths` 过滤让"我只改了 README 或配置"的 push 不触发
- `concurrency` 防止连续两次 push 引起竞态（前一次还没写回 id，后一次又 create 一遍）
- `fetch-depth: 2` 才够算 `HEAD~1..HEAD` 的 diff
- `permissions: contents: write` 才允许回写 commit

### 每篇文章的状态

前两篇文章现在的 frontmatter 尾部看起来是这样：

```yaml
crosspost:
  devto:
    id: 3544836
    url: "https://dev.to/lizhaopengcn/..."
  hashnode:
    id: 69eb1b54bada4a44e9c589e2
    url: "https://xtuul.hashnode.dev/..."
```

以后任何一篇我改了正文 push 上去，脚本看到已有 id，走 update 路径，**平台上直接原地更新**，url 不变、评论不丢。

## 小结

这篇的主题本来应该是"跨平台分发"，实际结果是"跨两个海外平台分发 + 一篇国内平台劝退录"。

一些可以带走的结论：

1. **canonical URL 必须显式**。主站永远是 source of truth，分发只是副本。
2. **幂等靠 id，不靠 title/slug 做匹配**。id 写回 frontmatter，和文章原子地一起 commit，不要引入外部状态。
3. **"默默成功"的平台要特别警惕**。dev.to 的 422 比 Hashnode 的 `-1-1` slug 友好得多。
4. **零运维的门槛是"不需要我再额外养任何一台机器"**。一旦为了一个副功能要上国内 VPS 或浏览器自动化，整个系统的维护成本结构就变了。

篇四还没想好，大概会写主站接入 Umami、或者 AstroPaper 主题的几处魔改。
