import { execFileSync } from "node:child_process";

/**
 * Files touched by the current push.
 * In GitHub Actions, `GITHUB_EVENT_BEFORE` and `GITHUB_SHA` bracket the push.
 * Locally fall back to HEAD~1..HEAD so dry-runs work.
 */
export function changedMarkdown(dir: string): string[] {
  const before = process.env.GITHUB_EVENT_BEFORE;
  const after = process.env.GITHUB_SHA ?? "HEAD";
  const range =
    before && /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before)
      ? `${before}..${after}`
      : "HEAD~1..HEAD";
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", range, "--", `${dir}/*.md`],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}
