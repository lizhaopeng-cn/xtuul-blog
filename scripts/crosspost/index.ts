import { resolve } from "node:path";
import { changedMarkdown } from "./lib/changed-files.js";
import { loadPost, writePost } from "./lib/frontmatter.js";
import type { Frontmatter, Post, PublishResult, Publisher } from "./lib/types.js";
import { devto } from "./platforms/devto.js";
import { hashnode } from "./platforms/hashnode.js";
import { cnblogs } from "./platforms/cnblogs.js";

const SITE_BASE = process.env.SITE_BASE ?? "https://blog.xtuul.com/";
const BLOG_DIR = "src/data/blog";
const DRY_RUN = process.env.DRY_RUN === "1";

const ALL_PUBLISHERS: Publisher[] = [devto, hashnode, cnblogs];

async function main() {
  const explicit = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const files =
    explicit.length > 0 ? explicit.map(f => resolve(f)) : changedMarkdown(BLOG_DIR);

  if (files.length === 0) {
    console.log("crosspost: no markdown changes, nothing to do.");
    return;
  }

  const enabled = ALL_PUBLISHERS.filter(p => p.enabled());
  if (enabled.length === 0) {
    console.log("crosspost: no platform secrets present, skipping.");
    return;
  }
  console.log(
    `crosspost: ${files.length} file(s), platforms: ${enabled.map(p => p.name).join(", ")}${DRY_RUN ? " [DRY RUN]" : ""}`,
  );

  let anyUpdate = false;
  for (const file of files) {
    const post = await loadPost(file, SITE_BASE);
    if (post.frontmatter.draft) {
      console.log(`  skip ${post.slug}: draft`);
      continue;
    }
    console.log(`  → ${post.slug}`);
    const results: PublishResult[] = [];
    for (const pub of enabled) {
      if (DRY_RUN) {
        console.log(`    [dry] would publish to ${pub.name}`);
        continue;
      }
      try {
        const r = await pub.publish(post);
        results.push(r);
        if (r.ok) {
          console.log(`    ✓ ${r.platform} ${r.action} → ${r.url}`);
        } else {
          console.log(`    ✗ ${r.platform} ${r.action}: ${r.error}`);
        }
      } catch (err) {
        console.log(`    ✗ ${pub.name} threw: ${(err as Error).message}`);
      }
    }
    if (!DRY_RUN) {
      const next = mergeResults(post.frontmatter, results);
      if (next) {
        await writePost(post, next);
        anyUpdate = true;
        console.log(`    wrote ids back to ${post.filePath}`);
      }
    }
  }

  // Surface a flag the workflow can read to decide whether to commit.
  if (anyUpdate && process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n");
  }
}

function mergeResults(
  fm: Frontmatter,
  results: PublishResult[],
): Frontmatter | null {
  const newlyCreated = results.filter(r => r.ok && r.action === "create");
  if (newlyCreated.length === 0) return null;
  const next: Frontmatter = { ...fm, crosspost: { ...(fm.crosspost ?? {}) } };
  for (const r of newlyCreated) {
    if (r.platform === "devto" && typeof r.id === "number") {
      next.crosspost!.devto = { id: r.id, url: r.url! };
    } else if (r.platform === "hashnode" && typeof r.id === "string") {
      next.crosspost!.hashnode = { id: r.id, url: r.url! };
    } else if (r.platform === "cnblogs" && typeof r.id === "string") {
      next.crosspost!.cnblogs = { id: r.id, url: r.url! };
    }
  }
  return next;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
