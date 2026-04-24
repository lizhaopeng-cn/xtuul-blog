---
author: Xtuul
pubDatetime: "2026-04-22T16:30:00+08:00"
title: 从零搭建个人技术博客 · 篇一：Astro + Cloudflare Pages + AstroPaper
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
crosspost:
  devto:
    id: 3544836
    url: "https://dev.to/lizhaopengcn/cong-ling-da-jian-ge-ren-ji-zhu-bo-ke-pian-astro-cloudflare-pages-astropaper-4ib"
  hashnode:
    id: 69eb1b54bada4a44e9c589e2
    url: "https://xtuul.hashnode.dev/astro-cloudflare-pages-astropaper"
---

这是"从零搭建个人技术博客"系列的第一篇，记录我把 `blog.xtuul.com` 从无到有跑起来的完整过程 —— 技术选型、架构、操作步骤、踩到的坑。

**本篇目标**：用最小的维护成本搭一个**快、干净、免费、有个人品牌感**的主站。
**不在本篇**：跨平台自动分发（dev.to / Hashnode / 掘金 / 公众号）—— 放到后续篇章。

## 目录

## 整体架构与选型

### 最终架构

```text
         Claude Code（在本地生成 Markdown）
                       │
                       ▼
          src/data/blog/xxx.md（Git 跟踪）
                       │  push
                       ▼
           GitHub: lizhaopeng-cn/xtuul-blog
                       │  webhook
                       ▼
              Cloudflare Pages（自动构建）
                       │
                       ▼
          blog.xtuul.com（HTTPS + 全球 CDN）
             + Cloudflare Web Analytics（站长后台）
             + 不蒜子（页面可见计数）
             + Giscus（GitHub Discussions 评论）
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

**全程只用 pnpm**。AstroPaper 官方模板、本地开发、Cloudflare Pages 构建命令都统一到 pnpm，保证只有一份 `pnpm-lock.yaml`，后面构建稳定性会省很多事。

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

## 用 Claude Code 直接产出 Markdown

上面的发布流程能跑，但**从 0 到一篇成稿还是我自己打字**。博客更顺手的工作流是：

```text
一句话需求 → Claude Code 写到 src/data/blog/xxx.md → 本地预览 → git push
```

我写博客的时候直接在仓库根目录开 Claude Code：

```bash
cd ~/projects/xtuul-blog
claude
```

然后一句话命题作文：

> "写一篇新文章放到 `src/data/blog/setup-astro-cloudflare-astropaper.md`，主题是从零搭建个人技术博客，选型是 Astro + Cloudflare Pages + AstroPaper，frontmatter 用 `author: Xtuul`、`pubDatetime` 用当前时间、`featured: true`、tags 给 astro/cloudflare/astropaper/blog/devops。"

Claude Code 直接落盘成 `.md` 文件，本地 `pnpm dev` 实时预览，不满意继续对话改（"第二部分太啰嗦，合并到第一部分"），满意了就 commit + push。

### 为什么要这样写，而不是甩一个"帮我写博客"

几点经验：

- **文件路径写死**。明确告诉 Claude 写到哪个文件、slug 是什么，它就会直接 `Write` 工具落盘，不会先在对话里生成一坨让你复制。
- **frontmatter 所有字段都写死**。作者、tags、是否 featured、是否 draft。Claude 对 AstroPaper 的 frontmatter schema 没先验知识，不写死它会漏字段或乱填。
- **技术选型和事实由你给**，Claude 负责组织行文和代码块。让 Claude 自由发挥容易出"正确但不是你的"内容——你的博客是写给你自己的受众，口吻、技术偏好、踩坑细节都得自己提供。
- **分多轮迭代**。先让它写大纲，再写某一节正文，再让它把某个代码块换成更简洁的版本。一次性让它写完 2000 字通常质量不如分块。

### 工作流的好处

- **不离开编辑器**：写、改、预览、提交在一个 shell 里完成，不用在对话窗口和编辑器之间来回切。
- **可追溯**：所有改动都是 `git diff`，不好回滚就 `git checkout --`。
- **自动化友好**：以后可以把"发布到 dev.to / Hashnode / 掘金"也交给 Claude Code 跑 MCP 调用外部 API，这是篇二要做的事。

## 第六步：接入访问统计与评论

主站能跑之后，马上会想要两件事：**这篇文章有多少人看过**、**读者能不能留言**。我接了三个互不重叠的服务：

| 需求 | 方案 | 数据给谁看 |
|---|---|---|
| 站长看流量后台（趋势、地理分布、Referer） | **Cloudflare Web Analytics** | 我，在 CF Dashboard |
| 页面上可见的计数（页脚总 PV/UV、文章阅读量） | **不蒜子** | 所有访客 |
| 评论系统 | **Giscus**（基于 GitHub Discussions） | 所有访客，数据在我仓库 |

全部免费、零后端。

### 6.1 Cloudflare Web Analytics

Dashboard → Analytics & Logs → Web Analytics → Add a site → 选 Manual（手动 JS 片段），会拿到一段：

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon='{"token": "YOUR_TOKEN"}'></script>
```

把它放到 `src/layouts/Layout.astro` 的 `<head>` 里（`<ClientRouter />` 之后），**全站自动上报**。

注意：

- **后台数据只有自己看**。访客看不到任何数字，不蒜子才是"前台展示"。
- **每个 site 一个独立 token**。我 `xtuul.com` 是橙云走自动统计，`blog.xtuul.com` 是 Pages 自带的灰云（Pages 的自定义域都是灰云，这是正常的，不用改橙），走不到自动统计，所以单独为它生成了 token。
- 如果你还想统计主站就再加一个 site、给主站页面嵌入对应 token 的片段即可，数据不会互相混。

### 6.2 不蒜子：页面可见计数

不蒜子是国内开发者博客最常用的极简计数器，一个 script + 三个约定的 span id：

```html
<!-- 站点总 PV -->
<span id="busuanzi_container_site_pv">
  总访问量 <span id="busuanzi_value_site_pv"></span> 次
</span>

<!-- 站点 UV -->
<span id="busuanzi_container_site_uv">
  访客数 <span id="busuanzi_value_site_uv"></span> 人
</span>

<!-- 当前文章 PV -->
<span id="busuanzi_container_page_pv">
  阅读量 <span id="busuanzi_value_page_pv"></span> 次
</span>
```

脚本只有三行：

```html
<script async defer
  src="https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js"></script>
```

**三个关键细节**：

1. **容器默认 `display:none`**。不蒜子脚本拿到数据后会把 `busuanzi_container_*` 显示出来。如果不默认隐藏，脚本返回前会看到 `访客数： 人` 这种裸文案，很丑。
2. **Astro ClientRouter 切页脚本不会重跑**。AstroPaper 用 `<ClientRouter />` 做无刷新页面切换，`<script src>` 只在首次加载时执行一次，**切换到下一篇文章的 page_pv 不会刷新**。解决：在 `astro:page-load` 事件里重新注入脚本。
3. **只在 `astro:page-load` 里注入，不要在 IIFE 里再调一次**。否则页面首次加载时首次 IIFE + `astro:page-load` 事件会各发一次 JSONP，**PV +2**。

最后得到的是这样一段：

```astro
<script is:inline>
  document.addEventListener("astro:page-load", () => {
    // 清掉上次注入的脚本标签
    document.querySelectorAll("script[data-busuanzi]")
      .forEach(node => node.remove());
    const s = document.createElement("script");
    s.src = "https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-busuanzi", "1");
    document.body.appendChild(s);
  });
</script>
```

**不蒜子的局限（被很多教程模糊带过）**：

- **只有 `page_pv`，没有 `page_uv`**。想知道某篇文章有多少独立访客——不蒜子做不到，只能自己上 Cloudflare Workers + KV。
- **本地 `localhost:4321` 的数字是全球所有本地开发者共享的**，动辄几万几十万，**这是正常现象**，上线到真实域名后从 0 开始计数。

### 6.3 Giscus：基于 GitHub Discussions 的评论

Giscus 把评论直接挂在你仓库的 GitHub Discussions 上。好处：

- 评论数据在你自己仓库，跟着仓库迁移走
- 访客用 GitHub 账号登录，天然过滤机器人
- 支持 reaction、Markdown、代码块
- 不要你跑任何后端

**准备工作**：

1. 仓库开启 Discussions：Settings → Features → Discussions ✅
2. 安装 [giscus GitHub App](https://github.com/apps/giscus) 到仓库
3. 去 [giscus.app](https://giscus.app) 配置向导，选 repo + discussion category（建议用 `Announcements` 这种受限分类，避免无关讨论），拿到一段 `<script>`

**在 Astro 里包装成组件**，关键要点有两个：

1. **主题要跟站内明暗同步**。Giscus 默认 `preferred_color_scheme` 跟系统，但 AstroPaper 允许用户手动切换 `<html data-theme="...">`，两者会对不上。要用 `MutationObserver` 监听 `data-theme` 变化，通过 `postMessage` 告诉 giscus iframe 换皮。
2. **ClientRouter 切页要重新挂载**。否则上一篇文章的评论残留在下一篇。

简化后的组件（完整版在仓库 `src/components/Giscus.astro`）：

```astro
<section id="giscus-container">
  <h2>评论</h2>
  <div id="giscus"></div>
</section>

<script is:inline data-astro-rerun>
  (function () {
    const container = document.getElementById("giscus");
    if (!container) return;
    container.innerHTML = ""; // 清理上一页残留

    function currentGiscusTheme() {
      return document.documentElement.getAttribute("data-theme") === "dark"
        ? "noborder_dark"
        : "noborder_light";
    }

    const s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.setAttribute("data-repo", "lizhaopeng-cn/xtuul-blog");
    s.setAttribute("data-repo-id", "...");
    s.setAttribute("data-category", "Announcements");
    s.setAttribute("data-category-id", "...");
    s.setAttribute("data-mapping", "pathname");
    s.setAttribute("data-theme", currentGiscusTheme());
    s.setAttribute("data-lang", "zh-CN");
    s.setAttribute("data-loading", "lazy");
    s.setAttribute("crossorigin", "anonymous");
    s.async = true;
    container.appendChild(s);

    // 站内主题切换时通知 iframe 同步
    new MutationObserver(() => {
      const frame = document.querySelector("iframe.giscus-frame");
      frame?.contentWindow?.postMessage(
        { giscus: { setConfig: { theme: currentGiscusTheme() } } },
        "https://giscus.app"
      );
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  })();
</script>
```

然后在 `src/layouts/PostDetails.astro` 里 `<Giscus />` 一行就挂上了。

## 踩过的坑

1. **Cloudflare Pages 不改构建命令**：默认的 `npm run build` 在项目只有 `pnpm-lock.yaml` 时会因为缺 `package-lock.json` 失败。**必须显式改成** `pnpm install --frozen-lockfile && pnpm build`。

2. **Node 版本**：不指定 `NODE_VERSION`，构建容器可能给你 18，新版 Astro 直接报错。

3. **默认主题探测**：AstroPaper 默认是跟随系统 `prefers-color-scheme`。想强制首次深色，改 `Layout.astro` 里的 `initialColorScheme = "dark"`，别去动 `lightAndDarkMode`（那个是**是否允许**切换的开关）。

4. **不蒜子在 `localhost:4321` 上数字离谱**：不蒜子按域名隔离，`localhost` 被所有开发者共享，本地看到几万几十万是正常的。上线到 `blog.xtuul.com` 才从 0 开始独立计数。

5. **Giscus 不跟随 AstroPaper 主题切换**：Giscus 默认用 `preferred_color_scheme` 跟系统，但 AstroPaper 允许用户点按钮切 `data-theme`，两者会脱节。必须用 `MutationObserver` 监听 `data-theme`，通过 `postMessage` 通知 iframe 换皮。

## 下一篇预告

**篇二：把一篇 Markdown 自动分发到 dev.to / Hashnode，canonical 指向主站。**

核心思路：

- 统一 frontmatter 里加 `syndicate: { devto: true, hashnode: true }` 开关
- GitHub Actions 监听 `src/data/blog/` 变化，调用各平台 API 发布/更新
- 首发后把平台返回的文章 ID 回写到 frontmatter，实现幂等更新

等系列跑完，最终目标是：**在 Claude Code 里一句话生成 md → `git push` → 全网同步更新**。
