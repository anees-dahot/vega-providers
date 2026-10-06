import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { cleanTitle, getBase, getHtml } from "./common";

function parsePosts(
  providerContext: ProviderContext,
  html: string,
): Post[] {
  const $ = providerContext.cheerio.load(html);
  const posts: Post[] = [];
  const seen = new Set<string>();
  $("article.herald-post, article.herald-lay-b").each((_, el) => {
    const a = $(el).find(".entry-title a").first();
    const link = a.attr("href") || "";
    if (!link || seen.has(link)) return;
    seen.add(link);
    const { title, audio } = cleanTitle(a.text());
    const image =
      $(el).find("img.wp-post-image").attr("src") ||
      $(el).find("img").first().attr("src") ||
      "";
    posts.push({
      title,
      link,
      image,
      ...(audio ? { cornerTag: audio.split("-")[0] } : {}),
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
    const path = filter ? `/${filter.replace(/^\/|\/$/g, "")}` : "";
    const url = `${base}${path}${page > 1 ? `/page/${page}/` : "/"}`;
    return parsePosts(providerContext, await getHtml(providerContext, url, signal));
  } catch (err: any) {
    // WordPress answers 404 past the last page.
    if (err?.response?.status === 404) return [];
    throwProviderError("ToonWorld", "posts", err);
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
    throwProviderError("ToonWorld", "search posts", err);
  }
};
