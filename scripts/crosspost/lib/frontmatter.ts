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
 * (`tags:` followed by `- x`), and nested objects via indentation
 * (needed for `crosspost.<platform>.{id,url}`).
 * A full YAML lib would be safer, but shipping one just to read our own files
 * felt heavier than the risk — revisit if we ever hit an edge case.
 */
function parseFrontmatter(block: string): Frontmatter {
  const lines = block.split("\n");
  const { value } = readObject(lines, 0, 0);
  return value as Frontmatter;
}

function indentOf(line: string): number {
  const m = line.match(/^( *)/);
  return m ? m[1].length : 0;
}

function isSkippable(line: string | undefined): boolean {
  return line === undefined || !line.trim() || line.trim().startsWith("#");
}

function readObject(
  lines: string[],
  start: number,
  indent: number,
): { value: Record<string, unknown>; next: number } {
  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) {
      i++;
      continue;
    }
    const kv = line
      .slice(indent)
      .match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, key, rest] = kv;
    if (rest !== "") {
      out[key] = parseScalar(rest);
      i++;
      continue;
    }
    // rest is empty → look ahead for a nested block
    let j = i + 1;
    while (j < lines.length && isSkippable(lines[j])) j++;
    if (j >= lines.length) {
      out[key] = null;
      i = j;
      continue;
    }
    const childIndent = indentOf(lines[j]);
    if (childIndent <= indent) {
      out[key] = null;
      i = j;
      continue;
    }
    if (lines[j].slice(childIndent).startsWith("- ")) {
      const { value, next } = readArray(lines, j, childIndent);
      out[key] = value;
      i = next;
    } else {
      const { value, next } = readObject(lines, j, childIndent);
      out[key] = value;
      i = next;
    }
  }
  return { value: out, next: i };
}

function readArray(
  lines: string[],
  start: number,
  indent: number,
): { value: unknown[]; next: number } {
  const arr: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind !== indent) break;
    const rest = line.slice(indent);
    if (!rest.startsWith("- ")) break;
    arr.push(parseScalar(rest.slice(2)));
    i++;
  }
  return { value: arr, next: i };
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

// Keys that Astro's schema parses as native dates — must be emitted as a bare
// YAML timestamp (no quotes), otherwise `z.date()` sees a string and the
// content-collection sync fails with `Expected type "date", received "string"`.
const DATETIME_KEYS = new Set(["pubDatetime", "modDatetime"]);

function emit(key: string, value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return `${key}: null`;
  if (DATETIME_KEYS.has(key) && (typeof value === "string" || value instanceof Date)) {
    const iso = value instanceof Date ? value.toISOString() : value;
    return `${key}: ${iso}`;
  }
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
