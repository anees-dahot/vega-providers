import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { request } from "./common";

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
        image: item.snapshot || "",
        cornerTag: item.episode != null ? `EP ${item.episode}` : undefined,
      });
    }
    return posts;
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
    const data = await request(
      providerContext,
      `/api?m=search&q=${encodeURIComponent(searchQuery)}&page=${page || 1}`,
      signal,
      true,
    );
    return (data?.data || [])
      .filter((a: any) => a.session && a.title)
      .map((a: any) => ({
        title: a.title,
        link: a.session,
        image: a.poster || "",
        cornerTag: a.type || undefined,
      }));
  } catch (err) {
    throwProviderError("AnimePahe", "search posts", err);
  }
};
