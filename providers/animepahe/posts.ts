import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { MINUTE, cached, coversByTitle, request, requestPaged } from "./common";

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
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    // AnimePahe's search ignores the page number, so later pages would repeat
    // page 1 forever. Return every result on page 1 and nothing after.
    if ((page || 1) > 1) return [];
    return await cached(
      providerContext,
      `search:${searchQuery.toLowerCase()}`,
      30 * MINUTE,
      async () => {
        const pages = await requestPaged(
          providerContext,
          `/api?m=search&q=${encodeURIComponent(searchQuery)}&page=`,
        );
        const seen = new Set<string>();
        const posts: Post[] = [];
        for (const pageData of pages) {
          for (const a of pageData?.data || []) {
            if (!a.session || !a.title || seen.has(a.session)) continue;
            seen.add(a.session);
            posts.push({
              title: a.title,
              link: a.session,
              image: "",
              cornerTag: a.type || undefined,
            });
          }
        }
        return withCovers(providerContext, posts);
      },
    );
  } catch (err) {
    throwProviderError("AnimePahe", "search posts", err);
  }
};
