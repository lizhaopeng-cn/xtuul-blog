import type { Post, Publisher, PublishResult } from "../lib/types.js";

const API = "https://dev.to/api/articles";

export const devto: Publisher = {
  name: "devto",
  enabled: () => !!process.env.DEVTO_API_KEY,
  async publish(post: Post): Promise<PublishResult> {
    const key = process.env.DEVTO_API_KEY!;
    const existingId = post.frontmatter.crosspost?.devto?.id;
    const body = {
      article: {
        title: post.frontmatter.title,
        body_markdown: post.body,
        published: post.frontmatter.draft !== true,
        tags: (post.frontmatter.tags ?? [])
          .slice(0, 4)
          .map(t => t.replace(/[^a-zA-Z0-9]/g, "")),
        canonical_url: post.canonicalURL,
        description: post.frontmatter.description,
      },
    };
    const url = existingId ? `${API}/${existingId}` : API;
    const method = existingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "api-key": key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        platform: "devto",
        ok: false,
        action: existingId ? "update" : "create",
        error: `${res.status} ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { id: number; url: string };
    return {
      platform: "devto",
      ok: true,
      action: existingId ? "update" : "create",
      id: json.id,
      url: json.url,
    };
  },
};
