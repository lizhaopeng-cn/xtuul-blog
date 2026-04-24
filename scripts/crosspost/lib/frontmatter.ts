import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Frontmatter, Post } from "./types.js";

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export async function loadPost(
  filePath: string,
  siteBase: string,
): Promise<Post> {
  const raw = await readFile(filePath, "utf8");
  const match = raw.match(FM_RE);
  if (!match) {
    throw new Error(`No frontmatter in ${filePath}`);
  }
  const [, fmBlock, body] = match;
  const frontmatter = parseFrontmatter(fmBlock);
  const slug =
    (frontmatter.slug as string | undefined) ?? basename(filePath, ".md");
  const canonicalURL =
    frontmatter.canonicalURL ?? `${siteBase.replace(/\/$/, "")}/posts/${slug}/`;
  return { filePath, slug, frontmatter, body: body.trim(), raw, canonicalURL };
}

/**
 * YAML parser trimmed to the shape AstroPaper posts actually use.
 * Handles scalars, inline strings (with or without quotes), block lists
 * (`tags:` followed by `- x`), and one level of nested object (`crosspost:`).
 * A full YAML lib would be safer, but shipping one just to read our own files
 * felt heavier than the risk — revisit if we ever hit an edge case.
 */
function parseFrontmatter(block: string): Frontmatter {
  const lines = block.split("\n");
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, key, rest] = kv;
    if (rest === "") {
      const { value, next } = readBlock(lines, i + 1);
      out[key] = value;
      i = next;
    } else {
      out[key] = parseScalar(rest);
      i++;
    }
  }
  return out as Frontmatter;
}

function readBlock(
  lines: string[],
  start: number,
): { value: unknown; next: number } {
  const first = lines[start];
  if (first?.match(/^\s*-\s+/)) {
    const arr: string[] = [];
    let j = start;
    while (j < lines.length && lines[j].match(/^\s*-\s+/)) {
      arr.push(parseScalar(lines[j].replace(/^\s*-\s+/, "")) as string);
      j++;
    }
    return { value: arr, next: j };
  }
  const obj: Record<string, unknown> = {};
  let j = start;
  while (j < lines.length && lines[j].match(/^\s{2,}[A-Za-z_]/)) {
    const m = lines[j].match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) break;
    obj[m[1]] = parseScalar(m[2]);
    j++;
  }
  return { value: obj, next: j };
}

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function stringifyFrontmatter(fm: Frontmatter): string {
  const lines: string[] = [];
  const keyOrder = [
    "author",
    "pubDatetime",
    "modDatetime",
    "title",
    "slug",
    "featured",
    "draft",
    "tags",
    "ogImage",
    "description",
    "canonicalURL",
    "hideEditPost",
    "timezone",
    "crosspost",
  ];
  const seen = new Set<string>();
  for (const key of keyOrder) {
    if (key in fm) {
      lines.push(emit(key, fm[key]));
      seen.add(key);
    }
  }
  for (const key of Object.keys(fm)) {
    if (!seen.has(key)) lines.push(emit(key, fm[key]));
  }
  return lines.filter(Boolean).join("\n");
}

function emit(key: string, value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return `${key}: null`;
  if (Array.isArray(value)) {
    return `${key}:\n${value.map(v => `  - ${scalar(v)}`).join("\n")}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${key}: {}`;
    const inner = entries
      .map(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const sub = Object.entries(v as Record<string, unknown>)
            .map(([sk, sv]) => `    ${sk}: ${scalar(sv)}`)
            .join("\n");
          return `  ${k}:\n${sub}`;
        }
        return `  ${k}: ${scalar(v)}`;
      })
      .join("\n");
    return `${key}:\n${inner}`;
  }
  return `${key}: ${scalar(value)}`;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  if (/[:#\[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

export async function writePost(post: Post, next: Frontmatter): Promise<void> {
  const fmText = stringifyFrontmatter(next);
  const out = `---\n${fmText}\n---\n\n${post.body}\n`;
  await writeFile(post.filePath, out, "utf8");
}
