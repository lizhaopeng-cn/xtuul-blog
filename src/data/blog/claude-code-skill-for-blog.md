---
author: Xtuul
pubDatetime: 2026-04-25T00:29:45+08:00
title: 从零搭建个人技术博客 · 篇三：用 Claude Code 的 skill 和 command 接管博客增删改查
slug: claude-code-skill-for-blog
featured: false
draft: false
tags:
  - blog
  - claude-code
  - skill
  - automation
description: 把 blog.xtuul.com 的新建/列表/修改/删除做成 /blog new、/blog list、/blog edit、/blog delete，全部走 Claude Code 的 slash command + skill。这篇记录怎么设计、怎么落盘、怎么跨会话全局可用。
crosspost:
  devto:
    id: 3546977
    url: "https://dev.to/lizhaopengcn/cong-ling-da-jian-ge-ren-ji-zhu-bo-ke-pian-san-yong-claude-code-de-skill-he-command-jie-guan-bo-ke-zeng-shan-gai-cha-3lm0"
  hashnode:
    id: 69eb9ada5ea34fe02de1a3d4
    url: "https://xtuul.hashnode.dev/claude-code-skill-command"
---

这是"从零搭建个人技术博客"系列的第三篇。前两篇讲了怎么把站点跑起来、怎么把文章自动分发到 dev.to / Hashnode；这一篇往回退一步，聊写作流本身 —— 写/改/删一篇博客的动作太零碎了，想把它自动化掉。

**本篇目标**：用 Claude Code 的 **slash command** + **skill** 给 `blog.xtuul.com` 装一个"AI 管家"，任何目录下都能敲：

```
/blog new "pnpm workspace 踩坑"
/blog list 只看草稿
/blog edit setup-astro-cloudflare-astropaper 把踩坑第 4 条扩展一下
/blog delete some-old-post
```

**不在本篇**：主站搭建（篇一）和跨平台分发（篇二）。

## 目录

## 为什么不用脚本

最朴素的方案是写几个 bash 脚本：`new-post.sh`、`list-posts.sh`、`delete-post.sh`。能用，但对我来说有三个硬伤：

1. **frontmatter 的写入仍然要我自己想**。脚本能填日期、slug、author，但 `title` / `tags` / `description` 这几个字段还是得我自己琢磨。AI 可以顺手把这几件事一起做了。
2. **自然语言参数处理不了**。我说"把篇一踩坑第 4 条扩展一下"，脚本怎么知道第 4 条在哪？Claude 能自己读文件理解结构。
3. **跨会话上下文。** 脚本不记得"我的博客在哪个目录、用什么 schema、风格是什么"；Claude Code 的 skill 可以把这些写进 `SKILL.md`，每次触发自动加载。

所以这次直接在 Claude Code 里做。

## Slash command vs Skill

开动之前先理清两个概念。Claude Code 里能扩展命令的有两样：

| | Slash command | Skill |
|---|---|---|
| 位置 | `~/.claude/commands/xxx.md` 或 `.claude/commands/xxx.md` | `~/.claude/skills/xxx/SKILL.md` 或 `.claude/skills/xxx/SKILL.md` |
| 触发 | **只能**显式 `/xxx` | `/xxx` **或** Claude 根据 description 自动匹配 |
| 结构 | 单文件 | 文件夹，可带 `templates/` `references/` `examples/` `scripts/` |
| 长度 | 适合一段短 prompt | 适合长 playbook（官方推荐 <2000 词） |
| 组合 | 一个命令可以调用 skill | skill 可以调用其他 skill |

**简单说**：skill 是 command 的超集。新写东西默认选 skill，除非只是"给我贴一段固定 prompt"。

但 `/blog new` 这种形态**必须**由 command 提供 —— skill 的 slash 名就是它自己的 `name`（比如 `/blog-new`），没法拆成 `/blog` + 子命令。所以最终方案是 **command 做路由 + 四个 skill 做实现**。

## 整体架构

```text
                      用户输入 /blog <sub> [args]
                                │
                                ▼
            ┌──────────────────────────────────────┐
            │ ~/.claude/commands/blog.md （路由）  │
            │  - 解析 $ARGUMENTS 第一个 token      │
            │  - 分派到对应 skill                  │
            └────────────────┬─────────────────────┘
                             │
       ┌──────────┬──────────┼──────────┬──────────┐
       ▼          ▼          ▼          ▼
   blog-new   blog-list  blog-edit  blog-delete
       │          │          │          │
       └──────────┴────┬─────┴──────────┘
                       │ 按需加载
                       ▼
       ~/.claude/skills/blog-shared/
         ├── templates/post.md
         ├── references/frontmatter-schema.md
         └── examples/reference-article.md
```

- **`blog.md`**（command）只做一件事：看 `$ARGUMENTS` 第一个词，转发给对应 skill。
- **四个 skill** 各自是独立的 playbook，互不干扰。`edit` 和 `delete` 在 slug 为空时会调用 `blog-list`（skill 之间可以互相调）。
- **`blog-shared`** 不是 skill，而是**共享资源目录**，放 frontmatter schema、正文模板、风格范文。所有 skill 都**按需**读它，不常驻上下文。

## 实现：command 薄壳

`~/.claude/commands/blog.md` 是一个带 YAML frontmatter 的 Markdown：

```markdown
---
argument-hint: <new|list|edit|delete> [参数或自由文本]
description: xtuul-blog 博客文章增删改查入口。按第一个词分派到对应 skill。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /blog 路由

用户输入：`$ARGUMENTS`

## 解析规则

1. 把 `$ARGUMENTS` 按**第一个空白**切分：
   - 第一个 token → **子命令**（必须是 new/list/edit/delete 之一）
   - 剩余全部文本 → **自由参数**，**原样**透传给对应 skill

2. 子命令和参数之间只用空格，不识别 `:` `|` `-` `#` 等分隔符。
   含空格的标题/slug 用双引号包裹。

## 执行

- new    → 调用 Skill `blog-new`，透传剩余文本
- list   → 调用 Skill `blog-list`，透传剩余文本
- edit   → 调用 Skill `blog-edit`，透传剩余文本
- delete → 调用 Skill `blog-delete`，透传剩余文本
- 其他或空 → 输出用法说明，不自行推断
```

**关键点**：不自己设计任何分隔符，只用空格 + 引号 + 自然语言。Claude 自己解析。

## 实现：blog-new skill

`~/.claude/skills/blog-new/SKILL.md`：

```markdown
---
name: blog-new
description: This skill should be used when the user asks to
  "write a new blog post", "draft an article", "新开一篇文章",
  "起草博客", or invokes `/blog new`. Creates a new markdown
  post under /Users/xtuul/projects/xtuul-blog/src/data/blog/
  following xtuul-blog's AstroPaper frontmatter schema.
  Does not touch git.
argument-hint: "[标题 或 主题描述]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# blog-new：起草一篇新文章

... 工作流 ...
```

**description 是 router 的命根子**。Claude 靠这段决定你说"新写一篇博客"要不要触发这个 skill。官方文档里强调三点：

- **第三人称**：`This skill should be used when...`，不用 `You should...`
- **具体触发短语**：把用户会怎么说列出来
- **中英文并列**：触发短语中英文都写，命中率更高

body 里按**祈使句**写步骤：确定标题 → 生成 slug → 写 frontmatter → 写正文 → 写入文件 → 汇报。参数为空时**追问**用户"想写什么"，而不是自己编。

## 实现：blog-list / edit / delete

- **`blog-list`**：`Glob src/data/blog/**/*.md`，读每个文件前 30 行 frontmatter，按 `pubDatetime` 降序出表格。支持自然语言过滤（"只看草稿"、"标签 astro"）。
- **`blog-edit`**：第一个 token 作 slug，剩余作修改意图。slug 为空时**调用 `blog-list`** 让用户选 —— skill 之间互相调用是合法的，而且复用现成逻辑最干净。
- **`blog-delete`**：**强制二次确认**。用户必须原样打出 `确认删除 <slug>` 才执行，回 `y`/`是`/`删` 一概不算。

### 为什么 delete 要这么死板

删除不走 git（本仓库 push 之前都在本地）。文件一旦 `rm` 就没了。
`y` 太容易手滑打出来，**原样复述 slug** 才能保证用户真的看清了要删哪篇。

## 共享资源：blog-shared

`blog-shared` 不是 skill —— 没有 `SKILL.md`，Claude 不会主动扫描它。它是普通文件夹：

```text
~/.claude/skills/blog-shared/
├── templates/post.md                # 带 {{...}} 占位符的正文骨架
├── references/frontmatter-schema.md # 字段硬规则（必填、格式、示例）
└── examples/reference-article.md    # draft: true 的风格范文
```

在各 skill 的 `## Additional Resources` 小节里**显式引用**绝对路径：

```markdown
## Additional Resources

- `~/.claude/skills/blog-shared/references/frontmatter-schema.md` — frontmatter 字段硬规则
- `~/.claude/skills/blog-shared/templates/post.md` — 正文骨架模板
- `~/.claude/skills/blog-shared/examples/reference-article.md` — 风格范文
```

Claude 触发 skill 时，只加载 SKILL.md body；**需要时**才 `Read` 上面这三个资源。这就是官方说的 **progressive disclosure**：主文件轻量化，详细内容按需加载。

好处很实在：改 schema 只改一个文件，四个 skill 自动跟着更新；改风格范文也不会污染真实的 `src/data/blog/`。

## 项目级 vs 用户级

Claude Code 支持两个位置：

| 位置 | 作用域 | 何时用 |
|---|---|---|
| `<repo>/.claude/` | 仅该仓库工作目录下生效 | 和仓库强耦合的命令；团队共享 |
| `~/.claude/` | 全局，任意目录都能用 | 个人工具、跨仓库可复用 |

两份同名会**项目级覆盖用户级**。

我最开始放在项目级，结果发现两个问题：

1. 必须 `cd ~/projects/xtuul-blog && claude` 才能用 `/blog`，在桌面/下载目录里想顺手开一篇博客就不行。
2. GitHub 仓库里有 `.claude/` 目录会被当成项目文件同步，别的设备或者协作者 clone 下来就自动启用了，不符合"这是我个人的工具"的定位。

所以搬到了用户级 `~/.claude/`，并把 SKILL.md 里所有 `src/data/blog/...` 相对路径**全部改成绝对路径** `/Users/xtuul/projects/xtuul-blog/src/data/blog/...`。代价是这套 skill 只能我这台机器用，但对我来说就是自己用，刚好。

## 踩过的坑

1. **`/blog` 首次调用报 Unknown command**。Claude Code 只在**会话启动时**扫描 commands 和 skills 目录。新建/搬迁文件后，**必须重启 Claude Code** 才能识别，`/reload` 之类的软重载不够。

2. **项目级和用户级同名冲突**。我忘了删项目级的旧版，新会话里仍然跑的是旧的相对路径 SKILL.md。删掉项目级的 `.claude/` 后正常。

3. **description 写得像文档就失效**。第一版我写了 `用于管理 xtuul-blog 的博客文章`，Claude 根本不匹配自然语言请求。改成 `This skill should be used when the user asks to "write a new blog post", "新开一篇文章", or invokes /blog new` 之后命中率立马上去。**description 是触发条件而不是文档**，越具体越好。

4. **skill body 超 2000 词后 Claude 抓不住重点**。第一版 `blog-new` 把 schema 字段表、风格约束全塞进去，400 多行。后来按官方推荐拆成 `SKILL.md`（只写流程）+ `references/frontmatter-schema.md`（字段表）+ `templates/post.md`（骨架），主文件压到 100 多行，生成质量明显好转。

5. **skill 内的路径必须是绝对路径**。只要没法保证用户一直在某个 CWD，**相对路径都是坑**。我在 SKILL.md 里硬编码了 `/Users/xtuul/projects/xtuul-blog/`，同时在每个 skill 开头加了一段"路径（硬编码绝对路径，不依赖 CWD）"说明 —— 未来换机器要改的地方集中在一处。

## 小结

- **架构**：`commands/blog.md` 做**路由薄壳**，四个独立 skill 做**实现**，一个 `blog-shared` 目录放**共享资源**
- **描述**：skill 的 `description` 用第三人称 + 具体中英文触发短语，直接决定 router 命中率
- **篇幅**：SKILL.md 控制在 <2000 词，详细内容走 `references/` 和 `templates/`，按需加载
- **路径**：全局 skill 里一律用**绝对路径**，不依赖当前工作目录
- **不碰 git**：所有 skill 都禁 `git` 命令，最终 push 前人工 review —— 博客的每一次提交都值得亲眼看一遍

下一步想把 `blog-new` 再增强一下：支持传入**参考文章 URL** 或**本地 markdown 路径**，Claude 读完后再写。这样写技术选型类文章时就不用我一段段复制粘贴上下文。

至此系列三篇闭环了：**篇一搭主站，篇二接分发，篇三管写作流**。以后写一篇博客就是打开任意终端敲 `/blog new 主题` → Claude 起稿 → 我修 → `git push` → workflow 自动同步到所有海外平台。整条链路零运维、按需生效，对一个人博客来说刚刚好。
