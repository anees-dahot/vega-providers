import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { MINUTE, cached, coversByTitle, request } from "./common";

async function withCovers(
  providerContext: ProviderContext,
  posts: Post[],
): Promise<Post[]> {
  const covers = await coversByTitle(
    providerContext,
    posts.map((p) => p.title),
  );
  return posts.map((p) => ({ ...p, image: covers[p.title] || p.image }));
}

export const getPosts = async function ({
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    // Latest-episode feed: newest releases first, one JSON call per page.
    // Cached briefly so switching screens doesn't reopen the WebView.
    return await cached(
      providerContext,
      `airing:${page || 1}`,
      2 * MINUTE,
      async () => {
        const data = await request(
          providerContext,
          `/api?m=airing&page=${page || 1}`,
          signal,
          true,
        );
        const seen = new Set<string>();
        const posts: Post[] = [];
        for (const item of data?.data || []) {
          const link = item.anime_session;
          if (!link || seen.has(link)) continue;
          seen.add(link);
          posts.push({
            title: item.anime_title,
            link,
            image: "",
            cornerTag: item.episode != null ? `EP ${item.episode}` : undefined,
          });
        }
        return withCovers(providerContext, posts);
      },
    );
  } catch (err) {
    throwProviderError("AnimePahe", "posts", err);
  }
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    return await cached(
      providerContext,
      `search:${searchQuery.toLowerCase()}:${page || 1}`,
      10 * MINUTE,
      async () => {
        const data = await request(
          providerContext,
          `/api?m=search&q=${encodeURIComponent(searchQuery)}&page=${page || 1}`,
          signal,
          true,
        );
        const posts: Post[] = (data?.data || [])
          .filter((a: any) => a.session && a.title)
          .map((a: any) => ({
            title: a.title,
            link: a.session,
            image: "",
            cornerTag: a.type || undefined,
          }));
        return withCovers(providerContext, posts);
      },
    );
  } catch (err) {
    throwProviderError("AnimePahe", "search posts", err);
  }
};
