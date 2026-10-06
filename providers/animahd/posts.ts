import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { cleanTitle, getBase } from "./common";

const FIELDS = "id,link,title,categories,_mal_cached_thumb,_animesuki_lang_badge";

async function fetchPosts(
  providerContext: ProviderContext,
  query: string,
  signal?: AbortSignal,
): Promise<Post[]> {
  const { axios, commonHeaders } = providerContext;
  const base = await getBase(providerContext);
  try {
    const res = await axios.get(
      `${base}/wp-json/wp/v2/posts?per_page=20&_fields=${FIELDS}&${query}`,
      { signal, headers: commonHeaders },
    );
    return (res.data || []).map((p: any) => {
      const { title, audio } = cleanTitle(p.title?.rendered || "");
      const badge = String(p._animesuki_lang_badge || "").trim() || audio.split("-")[0];
      return {
        title,
        link: p.link,
        image: p._mal_cached_thumb || "",
        ...(badge ? { cornerTag: badge } : {}),
      } as Post;
    });
  } catch (err: any) {
    // WordPress answers 400 past the last page.
    if (err?.response?.status === 400 || err?.response?.status === 404) return [];
    throw err;
  }
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
    return await fetchPosts(
      providerContext,
      `page=${page || 1}${filter ? `&categories=${encodeURIComponent(filter)}` : ""}`,
      signal,
    );
  } catch (err) {
    throwProviderError("AnimaHD", "posts", err);
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
    return await fetchPosts(
      providerContext,
      `page=${page || 1}&search=${encodeURIComponent(searchQuery)}`,
      signal,
    );
  } catch (err) {
    throwProviderError("AnimaHD", "search posts", err);
  }
};
