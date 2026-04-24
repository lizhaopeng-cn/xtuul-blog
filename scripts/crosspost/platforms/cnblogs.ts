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

function parseStringResponse(xml: string): string {
  const fault = xml.match(
    /<fault>[\s\S]*?<member><name>faultString<\/name><value><string>([\s\S]*?)<\/string>/,
  );
  if (fault) throw new Error(`cnblogs fault: ${fault[1]}`);
  const m =
    xml.match(/<param>\s*<value>\s*<string>([\s\S]*?)<\/string>/) ||
    xml.match(/<param>\s*<value>([\s\S]*?)<\/value>/);
  if (!m) throw new Error(`cnblogs: unexpected response: ${xml.slice(0, 200)}`);
  return m[1].trim();
}

function parseBoolResponse(xml: string): boolean {
  const fault = xml.match(
    /<fault>[\s\S]*?<member><name>faultString<\/name><value><string>([\s\S]*?)<\/string>/,
  );
  if (fault) throw new Error(`cnblogs fault: ${fault[1]}`);
  return /<boolean>1<\/boolean>/.test(xml);
}

export const cnblogs: Publisher = {
  name: "cnblogs",
  enabled: () =>
    !!process.env.CNBLOGS_USERNAME && !!process.env.CNBLOGS_APP_KEY,
  async publish(post: Post): Promise<PublishResult> {
    const user = process.env.CNBLOGS_USERNAME!;
    const key = process.env.CNBLOGS_APP_KEY!;
    const endpoint = `https://rpc.cnblogs.com/metaweblog/${encodeURIComponent(user)}`;
    const existing = post.frontmatter.crosspost?.cnblogs;

    try {
      if (existing?.id) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/xml" },
          body: buildEditPostXml(user, key, existing.id, post),
        });
        const xml = await res.text();
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
      const id = parseStringResponse(xml);
      const url = `https://www.cnblogs.com/${user}/p/${id}.html`;
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
