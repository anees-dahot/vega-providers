import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { getBase, img, tmdb } from "./common";

async function toPosts(
  providerContext: ProviderContext,
  results: any[],
  fallbackType: string,
): Promise<Post[]> {
  const base = await getBase(providerContext);
  return (results || [])
    .map((r: any) => ({ ...r, media_type: r.media_type || fallbackType }))
    .filter((r: any) => (r.media_type === "movie" || r.media_type === "tv") && r.poster_path)
    .map((r: any) => ({
      title: r.title || r.name || "",
      link: `${base}/details/${r.media_type}/${r.id}`,
      image: img(r.poster_path),
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
    const data = await tmdb(providerContext, filter, { page: page || 1 }, signal);
    const fallbackType = /\/tv\b/.test(filter) ? "tv" : "movie";
    return await toPosts(providerContext, data?.results, fallbackType);
  } catch (err) {
    throwProviderError("Flixbaba", "posts", err);
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
    const data = await tmdb(
      providerContext,
      "/search/multi",
      { query: searchQuery, page: page || 1 },
      signal,
    );
    return await toPosts(providerContext, data?.results, "");
  } catch (err) {
    throwProviderError("Flixbaba", "search posts", err);
  }
};
