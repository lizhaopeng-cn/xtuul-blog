import type { Post, Publisher, PublishResult } from "../lib/types.js";

/**
 * 博客园 MetaWeblog API.
 * Endpoint: https://rpc.cnblogs.com/metaweblog/{username}
 * Protocol: XML-RPC. We hand-roll the XML because the 3 methods we need
 * (newPost / editPost / getPost) are simple, and pulling in an xml-rpc
 * dependency just for this felt heavier than the maintenance cost of
 * ~80 lines of string assembly.
 *
 * Cnblogs requires the app key (from 博客设置 → "MetaWeblog 访问") — NOT the
 * account password.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildNewPostXml(
  user: string,
  key: string,
  post: Post,
): string {
  const categories = (post.frontmatter.tags ?? [])
    .map(t => `<value><string>${xmlEscape(t)}</string></value>`)
    .join("");
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>metaWeblog.newPost</methodName>
  <params>
    <param><value><string>${xmlEscape(user)}</string></value></param>
    <param><value><string>${xmlEscape(user)}</string></value></param>
    <param><value><string>${xmlEscape(key)}</string></value></param>
    <param><value><struct>
      <member><name>title</name><value><string>${xmlEscape(post.frontmatter.title)}</string></value></member>
      <member><name>description</name><value><string>${xmlEscape(post.body)}</string></value></member>
      <member><name>categories</name><value><array><data>${categories}</data></array></value></member>
      <member><name>mt_keywords</name><value><string>${xmlEscape((post.frontmatter.tags ?? []).join(","))}</string></value></member>
    </struct></value></param>
    <param><value><boolean>${post.frontmatter.draft ? 0 : 1}</boolean></value></param>
  </params>
</methodCall>`;
}

function buildEditPostXml(
  user: string,
  key: string,
  postId: string,
  post: Post,
): string {
  const categories = (post.frontmatter.tags ?? [])
    .map(t => `<value><string>${xmlEscape(t)}</string></value>`)
    .join("");
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>metaWeblog.editPost</methodName>
  <params>
    <param><value><string>${xmlEscape(postId)}</string></value></param>
    <param><value><string>${xmlEscape(user)}</string></value></param>
    <param><value><string>${xmlEscape(key)}</string></value></param>
    <param><value><struct>
      <member><name>title</name><value><string>${xmlEscape(post.frontmatter.title)}</string></value></member>
      <member><name>description</name><value><string>${xmlEscape(post.body)}</string></value></member>
      <member><name>categories</name><value><array><data>${categories}</data></array></value></member>
      <member><name>mt_keywords</name><value><string>${xmlEscape((post.frontmatter.tags ?? []).join(","))}</string></value></member>
    </struct></value></param>
    <param><value><boolean>${post.frontmatter.draft ? 0 : 1}</boolean></value></param>
  </params>
</methodCall>`;
}

function extractFault(xml: string): string | null {
  const str = xml.match(
    /<fault>[\s\S]*?<member><name>faultString<\/name><value><string>([\s\S]*?)<\/string>/,
  );
  if (str) return `faultString=${str[1]}`;
  const code = xml.match(
    /<fault>[\s\S]*?<member><name>faultCode<\/name><value><int>(\d+)<\/int>/,
  );
  if (code) return `faultCode=${code[1]}`;
  return null;
}

function parseStringResponse(xml: string): string {
  const fault = extractFault(xml);
  if (fault) throw new Error(`cnblogs fault: ${fault}`);
  const m =
    xml.match(/<param>\s*<value>\s*<string>([\s\S]*?)<\/string>/) ||
    xml.match(/<param>\s*<value>([\s\S]*?)<\/value>/);
  if (!m) throw new Error(`cnblogs: unexpected response: ${xml.slice(0, 300)}`);
  return m[1].trim();
}

function parseBoolResponse(xml: string): boolean {
  const fault = extractFault(xml);
  if (fault) throw new Error(`cnblogs fault: ${fault}`);
  return /<boolean>1<\/boolean>/.test(xml);
}

function describeHttp(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").slice(0, 300);
  return `HTTP ${status} ${snippet || "(empty body)"}`;
}

export const cnblogs: Publisher = {
  name: "cnblogs",
  enabled: () =>
    !!process.env.CNBLOGS_USERNAME && !!process.env.CNBLOGS_APP_KEY,
  async publish(post: Post): Promise<PublishResult> {
    const user = process.env.CNBLOGS_USERNAME!;
    const key = process.env.CNBLOGS_APP_KEY!;
    // 博客园的 MetaWeblog 登录名（CNBLOGS_USERNAME，比如 lzzzp）和博客地址
    // slug（出现在文章 URL 里，比如 lizhaopeng）经常不是同一个。登录名用于
    // 鉴权，slug 用于拼 endpoint 和文章永久链接。没配 slug 就退回登录名，
    // 保持和历史行为一致。
    const blogSlug = process.env.CNBLOGS_BLOG_SLUG || user;
    const endpoint = `https://rpc.cnblogs.com/metaweblog/${encodeURIComponent(blogSlug)}`;
    const existing = post.frontmatter.crosspost?.cnblogs;

    try {
      if (existing?.id) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/xml" },
          body: buildEditPostXml(user, key, existing.id, post),
        });
        const xml = await res.text();
        if (!res.ok) throw new Error(describeHttp(res.status, xml));
        parseBoolResponse(xml);
        return {
          platform: "cnblogs",
          ok: true,
          action: "update",
          id: existing.id,
          url: existing.url,
        };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body: buildNewPostXml(user, key, post),
      });
      const xml = await res.text();
      if (!res.ok) throw new Error(describeHttp(res.status, xml));
      const id = parseStringResponse(xml);
      const url = `https://www.cnblogs.com/${blogSlug}/p/${id}.html`;
      return { platform: "cnblogs", ok: true, action: "create", id, url };
    } catch (err) {
      return {
        platform: "cnblogs",
        ok: false,
        action: existing?.id ? "update" : "create",
        error: (err as Error).message,
      };
    }
  },
};
