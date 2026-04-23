# Xtuul Blog

> [blog.xtuul.com](https://blog.xtuul.com) 的源码。记录 AI、编程、自动化和个人项目。

这是我的个人博客。基于 [AstroPaper](https://github.com/satnaing/astro-paper) 主题二次开发，部署在 Cloudflare Pages 上，一次 `git push` 就全自动上线。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | [Astro](https://astro.build/) |
| 主题 | [AstroPaper](https://github.com/satnaing/astro-paper)（二次开发） |
| 类型检查 | TypeScript |
| 样式 | [TailwindCSS](https://tailwindcss.com/) |
| 静态搜索 | [Pagefind](https://pagefind.app/) |
| 托管 | [Cloudflare Pages](https://pages.cloudflare.com/) |
| 站长分析 | Cloudflare Web Analytics |
| 页面计数 | [不蒜子](https://busuanzi.ibruce.info/) |
| 评论 | [Giscus](https://giscus.app/)（基于 GitHub Discussions） |
| 包管理 | pnpm |

## 功能

- 零 JS 默认、静态输出、Lighthouse 100
- 明暗主题切换、中文本地化 UI
- 文章标签、归档、全站搜索、分页
- RSS + sitemap + 动态 OG 图
- 站点级 PV/UV 展示在页脚，文章级阅读量展示在标题下方
- 文章底部 Giscus 评论，主题跟随站内明暗切换
- Cloudflare Web Analytics 站长后台（访客看不到）

## 目录结构

```text
/
├── public/                      # 静态资源（favicon、OG 图等）
├── src/
│   ├── assets/                  # 图标、图片
│   ├── components/              # 通用组件
│   │   └── Giscus.astro         # 评论组件（随主题切换）
│   ├── data/
│   │   └── blog/                # 所有文章的 Markdown 都在这里
│   ├── layouts/
│   │   ├── Layout.astro         # 全站壳（含 CF Analytics + 不蒜子注入）
│   │   └── PostDetails.astro    # 文章详情页
│   ├── pages/                   # 路由入口
│   ├── scripts/                 # 客户端脚本（主题切换等）
│   ├── styles/                  # 全局样式
│   ├── utils/                   # 工具函数
│   ├── config.ts                # 站点核心配置（标题、作者、时区等）
│   └── constants.ts             # 社交链接、分享平台
└── astro.config.ts              # Astro + Markdown + Shiki + 字体配置
```

## 本地开发

需要 Node 20+ 和 pnpm。

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # 输出到 dist/
pnpm preview    # 本地预览构建产物
pnpm lint       # ESLint
pnpm format     # Prettier
```

## 发布新文章

文章放在 `src/data/blog/` 下，文件名即 URL slug。

**frontmatter 模板：**

```yaml
---
author: Xtuul
pubDatetime: 2026-04-23T10:30:00+08:00
title: "文章标题"
slug: article-slug
featured: false   # true 首页置顶
draft: false      # true 仅本地预览
tags:
  - tag1
description: 一句话摘要（卡片和 SEO 描述用）
---
```

**发布流程：**

```bash
# 1. 写 / 让 Claude Code 写到 src/data/blog/xxx.md
# 2. 本地预览
pnpm dev
# 3. 推送，Cloudflare Pages 自动构建 + 部署
git add src/data/blog/xxx.md
git commit -m "post: 标题"
git push
```

从 push 到 `blog.xtuul.com` 可见通常 2 分钟内。

## 部署

Cloudflare Pages 构建配置：

- **Build command**: `pnpm install --frozen-lockfile && pnpm build`
- **Build output**: `dist`
- **Environment variables**: `NODE_VERSION = 22`

自定义域 `blog.xtuul.com` 由 Cloudflare DNS 自动指向 `xtuul-blog.pages.dev`（灰云是正常的，Pages 自带 CDN + HTTPS，不需要走额外一层橙云代理）。

## 致谢

主题基于 [AstroPaper](https://github.com/satnaing/astro-paper) by [Sat Naing](https://satnaing.dev)，感谢原作者的开源工作。原主题采用 MIT 许可证，本仓库保留其版权声明。

## License

- **主题代码**：基于 AstroPaper，遵循 [MIT License](https://github.com/satnaing/astro-paper/blob/main/LICENSE)
- **文章内容**（`src/data/blog/` 下所有 Markdown）：版权 © Xtuul，保留所有权利，未经许可不得转载
