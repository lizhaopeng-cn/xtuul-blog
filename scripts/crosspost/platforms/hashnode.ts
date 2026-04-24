import type { Post, Publisher, PublishResult } from "../lib/types.js";

const GQL = "https://gql.hashnode.com";

// Hashnode tags are normalized objects { name, slug } — accepts new ones as
// long as name+slug are sane; we derive them from our local tags.
function toHashnodeTags(tags: string[]): Array<{ name: string; slug: string }> {
  return tags.slice(0, 5).map(t => ({
    name: t,
    slug: t.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  }));
}

async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map(e => e.message).join("; "));
  }
  return json.data!;
}

export const hashnode: Publisher = {
  name: "hashnode",
  enabled: () =>
    !!process.env.HASHNODE_API_KEY &&
    !!process.env.HASHNODE_PUBLICATION_ID,
  async publish(post: Post): Promise<PublishResult> {
    const token = process.env.HASHNODE_API_KEY!;
    const publicationId = process.env.HASHNODE_PUBLICATION_ID!;
    const existing = post.frontmatter.crosspost?.hashnode;

    try {
      if (existing?.id) {
        const data = await gql<{
          updatePost: { post: { id: string; url: string } };
        }>(
          token,
          `mutation Update($input: UpdatePostInput!) {
            updatePost(input: $input) { post { id url } }
          }`,
          {
            input: {
              id: existing.id,
              title: post.frontmatter.title,
              contentMarkdown: post.body,
              tags: toHashnodeTags(post.frontmatter.tags ?? []),
              originalArticleURL: post.canonicalURL,
              subtitle: post.frontmatter.description,
            },
          },
        );
        return {
          platform: "hashnode",
          ok: true,
          action: "update",
          id: data.updatePost.post.id,
          url: data.updatePost.post.url,
        };
      }

      const data = await gql<{
        publishPost: { post: { id: string; url: string } };
      }>(
        token,
        `mutation Publish($input: PublishPostInput!) {
          publishPost(input: $input) { post { id url } }
        }`,
        {
          input: {
            publicationId,
            title: post.frontmatter.title,
            contentMarkdown: post.body,
            tags: toHashnodeTags(post.frontmatter.tags ?? []),
            originalArticleURL: post.canonicalURL,
            subtitle: post.frontmatter.description,
          },
        },
      );
      return {
        platform: "hashnode",
        ok: true,
        action: "create",
        id: data.publishPost.post.id,
        url: data.publishPost.post.url,
      };
    } catch (err) {
      return {
        platform: "hashnode",
        ok: false,
        action: existing?.id ? "update" : "create",
        error: (err as Error).message,
      };
    }
  },
};
