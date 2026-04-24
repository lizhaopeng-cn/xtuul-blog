# crosspost

把 `src/data/blog/*.md` 发到 dev.to / Hashnode / 博客园。

## 触发方式

- **GitHub Actions**: `.github/workflows/syndicate.yml` 在 push 到 `main` 时跑，自动识别 diff 内的文章。
- **本地**: `pnpm dlx tsx scripts/crosspost/index.ts [file1.md file2.md]`
  - 不传参数 = 读 `HEAD~1..HEAD` 的 diff
  - 传文件路径 = 直接发那几个文件
  - 环境变量 `DRY_RUN=1` 只打印不发

## Secrets

在 GitHub 仓库的 Settings → Secrets and variables → Actions 添加：

| Secret | 从哪拿 | 缺省行为 |
|---|---|---|
| `DEVTO_API_KEY` | dev.to → Settings → Extensions → DEV API Keys | 不配就跳过 dev.to |
| `HASHNODE_API_KEY` | Hashnode → Settings → Developer → Personal Access Token | 不配就跳过 Hashnode |
| `HASHNODE_PUBLICATION_ID` | Hashnode blog dashboard URL 里的 publication ID | 必须和 API key 同时配 |
| `CNBLOGS_USERNAME` | 博客园用户名（URL 里的 `/u/xxx` 那段） | 不配就跳过博客园 |
| `CNBLOGS_APP_KEY` | 博客园 → 设置 → "MetaWeblog 访问" → 应用密钥 | 必须和 username 同时配 |

## 行为

- 只处理 `draft: false` 的文章
- 首发后把平台返回的 `id + url` 写回文章 frontmatter 的 `crosspost` 字段，auto-commit 回 `main`
- 再次推送同一篇 → 根据 ID 走 update，不会产生重复文章
- canonical URL 固定指向 `https://blog.xtuul.com/posts/<slug>/`
- 任一平台失败不阻塞其他平台（per-post 串行，per-platform 彼此独立）
