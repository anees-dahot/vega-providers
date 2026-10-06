import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { absolute, getBase, getHtml } from "./common";

function parsePosts(
  providerContext: ProviderContext,
  base: string,
  html: string,
): Post[] {
  const $ = providerContext.cheerio.load(html);
  const posts: Post[] = [];
  const seen = new Set<string>();
  $("li article.post").each((_, el) => {
    const href = $(el).find("a.lnk-blk").attr("href") || "";
    if (!/\/(series|movies)\//.test(href) || seen.has(href)) return;
    seen.add(href);
    const title = $(el).find(".entry-title").first().text().replace(/\s+/g, " ").trim();
    const image = $(el).find("img").first().attr("src") || "";
    posts.push({
      title,
      link: absolute(base, href),
      image: image.replace(/(\/t\/p\/w\d+)\/\//, "$1/"),
      cornerTag: href.includes("/movies/") ? "Movie" : undefined,
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
    const url = `${base}/${filter.replace(/^\/|\/$/g, "")}?type=all&page=${page || 1}`;
    return parsePosts(providerContext, base, await getHtml(providerContext, url, signal));
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throwProviderError("ToonStream", "posts", err);
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
    const url = `${base}/s?q=${encodeURIComponent(searchQuery)}&page=${page || 1}`;
    return parsePosts(providerContext, base, await getHtml(providerContext, url, signal));
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throwProviderError("ToonStream", "search posts", err);
  }
};
