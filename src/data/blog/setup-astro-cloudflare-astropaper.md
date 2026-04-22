---
author: Xtuul
pubDatetime: 2026-04-22T16:30:00+08:00
title: "从零搭建个人技术博客 · 篇一：Astro + Cloudflare Pages + AstroPaper"
slug: setup-astro-cloudflare-astropaper
featured: true
draft: false
tags:
  - astro
  - cloudflare
  - astropaper
  - blog
  - devops
description: 一个程序员博客的基础设施落地：静态站用什么技术、为什么这么选、如何从一个空目录跑到线上 https 访问。篇一只做主站，后续篇章再接自动化分发。
---

这是"从零搭建个人技术博客"系列的第一篇，记录我把 `blog.xtuul.com` 从无到有跑起来的完整过程 —— 技术选型、架构、操作步骤、踩到的坑。

**本篇目标**：用最小的维护成本搭一个**快、干净、免费、有个人品牌感**的主站。
**不在本篇**：跨平台自动分发（dev.to / Hashnode / 掘金 / 公众号）—— 放到后续篇章。

## 目录

## 整体架构与选型

### 最终架构

```text
               写作（Markdown + Git）
                       │
                       ▼
           GitHub: lizhaopeng-cn/xtuul-blog
                       │  push
                       ▼
              Cloudflare Pages（自动构建）
                       │
                       ▼
          blog.xtuul.com（HTTPS + 全球 CDN）
```

一个仓库、一次 push、全自动部署。没有服务器、没有数据库、没有后台。

### 为什么选这套组合

| 层 | 选型 | 为什么 |
|---|---|---|
| 框架 | **Astro** | 静态输出、零 JS 默认、支持 MD/MDX、生态比 Hugo 现代、比 Next.js 轻 |
| 主题 | **AstroPaper** | Lighthouse 100、自带明暗主题/搜索/标签/RSS/sitemap、TypeScript + Tailwind |
| 托管 | **Cloudflare Pages** | 免费、自带 CDN 和 HTTPS、与 Cloudflare DNS 天然融合 |
| DNS | **Cloudflare** | 域名本来就在这里，一条 CNAME 都省了 |
| 包管理 | **pnpm** | 磁盘效率和 monorepo 友好；AstroPaper 官方模板就是 pnpm |

### 排除项（为什么不选它们）

- **WordPress** —— 要维护数据库、安全补丁、主机账单。静态博客是一次性工作，没必要。
- **Hexo / VuePress** —— 能用但生态趋冷，主题更新慢。
- **Next.js** —— 大炮打蚊子。博客不需要 SSR / Server Components。
- **Vercel** —— 也不错，但国内访问不如 Cloudflare 稳，且 DNS 不在一处。
- **GitHub Pages** —— 无 CDN、自定义域名要额外配置、国内访问慢。

## 前置条件

- 一个顶级域名（我用的 `xtuul.com`），**已托管在 Cloudflare**
- 本地装好：`node` (20+)、`pnpm`、`git`、`gh`（GitHub CLI）
- 一个 GitHub 账号，`gh auth login` 登录过

验证：

```bash
node -v          # v20 以上
pnpm -v
git --version
gh auth status
```

## 第一步：用 pnpm 脚手架生成 AstroPaper

```bash
cd ~/projects
pnpm create astro@latest xtuul-blog \
  --template satnaing/astro-paper \
  --install \
  --skip-houston \
  --no-git \
  --yes
```

参数含义：

- `--template satnaing/astro-paper` 直接以 AstroPaper 作为起点
- `--install` 自动 `pnpm install`
- `--no-git` 先不初始化 git，后面手动推（避免 Astro 默认 commit 污染历史）
- `--skip-houston` / `--yes` 跳过交互式问答

完成后：

```bash
cd xtuul-blog
pnpm dev
# 浏览器访问 http://localhost:4321/ 应该能看到 AstroPaper 默认主题
```

## 第二步：品牌化与本地化

AstroPaper 的**全站配置**集中在 `src/config.ts`。把站点信息改成自己的：

```ts
// src/config.ts
export const SITE = {
  website: "https://blog.xtuul.com/",
  author: "Xtuul",
  profile: "https://github.com/lizhaopeng-cn",
  desc: "记录 AI、编程、自动化和个人项目。",
  title: "Xtuul Blog",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000,
  showArchives: true,
  showBackButton: true,
  editPost: { enabled: false, text: "", url: "" },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
} as const;
```

**社交链接**在 `src/constants.ts`，默认带了 X / LinkedIn / WhatsApp 等，按需裁剪。我只留 GitHub + 邮箱：

```ts
export const SOCIALS: Social[] = [
  { name: "GitHub", href: "https://github.com/lizhaopeng-cn", linkTitle: `${SITE.title} on GitHub`, icon: IconGitHub },
  { name: "Mail", href: "mailto:xtuul@xtuul.com", linkTitle: `Send an email to ${SITE.title}`, icon: IconMail },
] as const;
```

### 导航栏中文化

`src/components/Header.astro` 里把 `Posts / Tags / About / Archives / Search` 改成 `文章 / 标签 / 关于 / 归档 / 搜索`，`Skip to content` 改成 `跳转到正文`。

### 默认深色模式

`src/layouts/Layout.astro` 里找到这段内联脚本，把空字符串改成 `"dark"`：

```js
const initialColorScheme = "dark"; // 之前是 ""，现在强制首访深色
```

`lightAndDarkMode: true` 保留，用户点顶部月亮/太阳按钮仍可切换。

### 验证本地构建

```bash
pnpm build
```

看到 `Finished in Xs` 并且没有红色错误，就说明配置改动都是合法的。

## 第三步：推送到 GitHub

```bash
cd ~/projects/xtuul-blog
git init
git add -A
git commit -m "initial commit: Xtuul Blog on AstroPaper"

# 用 gh 一条命令建 public 仓库 + 推送
gh repo create xtuul-blog --public --source=. --remote=origin --push
```

> **public 还是 private？** 博客内容公开，仓库也建议 public。public 仓库的 GitHub Actions 额度是**无限**的，private 每月只有 2000 分钟，这在后续加自动分发时会成为实际差别。

## 第四步：Cloudflare Pages 首次部署

Dashboard → **Workers & Pages** → Create → Pages → Connect to Git。

- 选仓库 `lizhaopeng-cn/xtuul-blog`
- Framework preset: `Astro`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Build output directory: `dist`
- Environment variables（Production）: `NODE_VERSION = 22`（纯文本）

> **为什么显式写 pnpm 命令**：Cloudflare Pages 默认根据 lockfile 探测包管理器，大多数情况会对，但偶尔会 fallback 到 npm。显式写最稳。
>
> **为什么固定 Node 版本**：构建容器默认 Node 可能是 18，而新版 Astro 要求 20+。指定 22 是目前的 LTS，最保险。

点 **Save and Deploy**，1–3 分钟后应该看到绿色 Success。

## 第五步：绑定自定义域名

Pages 项目 → **Custom domains** → Set up a custom domain → 填 `blog.xtuul.com`。

因为域名本来就在 Cloudflare，它会**自动在 DNS 区加一条 CNAME**：

```text
blog    CNAME    xtuul-blog.pages.dev    (Proxied)
```

等几十秒证书签发完成，`https://blog.xtuul.com/` 就活了。

## 以后发布新文章的流程

**文章存放位置**：`src/data/blog/`（文件名即 URL slug）。

### 标准 frontmatter 模板

```yaml
---
author: Xtuul
pubDatetime: 2026-04-22T10:30:00+08:00
title: "文章标题"
slug: article-slug
featured: false   # true 显示在首页"精选文章"
draft: false      # true 不会发布
tags:
  - tag1
  - tag2
description: 一句话摘要（会出现在文章卡片和 SEO 描述里）
---

正文...
```

### 三步发布

```bash
# 1. 写文章（放到 src/data/blog/xxx.md）
# 2. 本地预览（可选）
pnpm dev

# 3. 提交推送
git add src/data/blog/xxx.md
git commit -m "post: 标题"
git push
```

Cloudflare Pages 监听到 push，自动构建 + 部署，**从 push 到线上可见通常 2 分钟内**。

### 写作期间的小技巧

- `draft: true` → 线上看不到但本地能预览，适合攒稿
- `featured: true` → 首页置顶
- 本地改 `src/config.ts` / 组件时 `pnpm dev` 会热更新

## 踩过的坑

1. **npm 和 pnpm 混用**：最开始用 `npm create astro@latest` 建了个默认博客模板，后来切 AstroPaper 又手动 `git clone` —— 中途混用了 npm 和 pnpm 导致 lockfile 一团乱。**结论**：一开始就决定用 pnpm，全程 pnpm。

2. **Cloudflare Pages 不改构建命令**：默认的 `npm run build` 在项目只有 `pnpm-lock.yaml` 时会因为缺 `package-lock.json` 失败。**必须显式改成** `pnpm install --frozen-lockfile && pnpm build`。

3. **Node 版本**：不指定 `NODE_VERSION`，构建容器可能给你 18，新版 Astro 直接报错。

4. **默认主题探测**：AstroPaper 默认是跟随系统 `prefers-color-scheme`。想强制首次深色，改 `Layout.astro` 里的 `initialColorScheme = "dark"`，别去动 `lightAndDarkMode`（那个是**是否允许**切换的开关）。

## 下一篇预告

**篇二：把一篇 Markdown 自动分发到 dev.to / Hashnode，canonical 指向主站。**

核心思路：

- 统一 frontmatter 里加 `syndicate: { devto: true, hashnode: true }` 开关
- GitHub Actions 监听 `src/data/blog/` 变化，调用各平台 API 发布/更新
- 首发后把平台返回的文章 ID 回写到 frontmatter，实现幂等更新

等系列跑完，最终目标是：**在 Claude Code 里一句话生成 md → `git push` → 全网同步更新**。
