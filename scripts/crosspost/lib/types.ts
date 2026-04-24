export interface Frontmatter {
  title: string;
  slug?: string;
  description: string;
  pubDatetime: string;
  modDatetime?: string | null;
  tags: string[];
  draft?: boolean;
  featured?: boolean;
  canonicalURL?: string;
  crosspost?: {
    devto?: { id: number; url: string };
    hashnode?: { id: string; url: string };
    cnblogs?: { id: string; url: string };
  };
  [key: string]: unknown;
}

export interface Post {
  filePath: string;
  slug: string;
  frontmatter: Frontmatter;
  body: string;
  raw: string;
  canonicalURL: string;
}

export interface PublishResult {
  platform: "devto" | "hashnode" | "cnblogs";
  ok: boolean;
  action: "create" | "update" | "skip";
  id?: string | number;
  url?: string;
  error?: string;
}

export interface Publisher {
  name: "devto" | "hashnode" | "cnblogs";
  enabled: () => boolean;
  publish: (post: Post) => Promise<PublishResult>;
}
