import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { api, titleOf } from "./common";

// The API pages with cursors; the cursor for page N+1 is remembered when page N loads.
async function list(
  providerContext: ProviderContext,
  query: string,
  limit: number,
  page: number,
  signal?: AbortSignal,
): Promise<Post[]> {
  const kv = providerContext.kvStore;
  const key = `cursor:${query}:${page}`;
  let cursor = "";
  if (page > 1) {
    cursor = (await kv?.get<string>(key)) || "";
    if (!cursor) return [];
  }
  // Some lists are a single page; their next cursor is refused.
  const fetchPage = () =>
    api(
    providerContext,
    `anime?${query}${/(^|&)limit=/.test(query) ? "" : `&limit=${limit}`}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`,
    signal,
  );
  const data = await fetchPage().catch((e) => {
    if (page > 1) return { data: [] };
    throw e;
  });
  if (data?.has_more && data?.next_cursor) {
    await kv?.set(`cursor:${query}:${page + 1}`, data.next_cursor);
  }
  return (data?.data || []).map((m: any) => ({
    title: titleOf(m),
    link: m.id,
    image: m.cover_url || "",
    ...(m.format === "MOVIE" ? { cornerTag: "Movie" } : {}),
  }));
}

export const getPosts = async function ({
  filter,
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
    return await list(providerContext, filter, 18, page || 1, signal);
  } catch (err) {
    throwProviderError("Miruro", "posts", err);
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
    return await list(
      providerContext,
      `q=${encodeURIComponent(searchQuery)}`,
      15,
      page || 1,
      signal,
    );
  } catch (err) {
    throwProviderError("Miruro", "search posts", err);
  }
};
