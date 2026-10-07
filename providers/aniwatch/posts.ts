import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { decodeEntities, getBase, getHtml } from "./common";

function parsePosts(providerContext: ProviderContext, html: string): Post[] {
  const $ = providerContext.cheerio.load(html);
  const posts: Post[] = [];
  const seen = new Set<string>();
  $(".flw-item").each((_, el) => {
    const a = $(el).find(".film-poster-ahref").first();
    const id = a.attr("data-id") || "";
    const href = a.attr("href") || $(el).find(".film-name a").attr("href") || "";
    if (!href || seen.has(id || href)) return;
    seen.add(id || href);
    const title = decodeEntities(a.attr("title") || $(el).find(".film-name a").text());
    const image =
      $(el).find("img").attr("data-src") || $(el).find("img").attr("src") || "";
    const eps = $(el).find(".tick-eps").first().text().trim();
    posts.push({
      title,
      link: href,
      image: decodeEntities(image),
      ...(eps ? { cornerTag: `EP ${eps}` } : {}),
    });
  });
  return posts;
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
    const base = await getBase(providerContext);
    const path = filter.replace(/^\/|\/$/g, "");
    const url = `${base}/${path}/${page > 1 ? `page/${page}/` : ""}`;
    return parsePosts(providerContext, await getHtml(providerContext, url, signal));
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throwProviderError("AniWatch", "posts", err);
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
    const base = await getBase(providerContext);
    const url = `${base}/${page > 1 ? `page/${page}/` : ""}?s=${encodeURIComponent(searchQuery)}`;
    return parsePosts(providerContext, await getHtml(providerContext, url, signal));
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throwProviderError("AniWatch", "search posts", err);
  }
};
