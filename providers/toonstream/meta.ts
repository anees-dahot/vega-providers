import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { absolute, getBase, getHtml } from "./common";

function parseEpisodes(
  providerContext: ProviderContext,
  base: string,
  html: string,
): NonNullable<Link["directLinks"]> {
  const $ = providerContext.cheerio.load(html);
  const out: NonNullable<Link["directLinks"]> = [];
  $("li article.post").each((_, el) => {
    const href = $(el).find("a.lnk-blk").attr("href");
    if (!href) return;
    const label = $(el).find(".entry-title1").text().replace(/\s+/g, " ").trim(); // "S 1 | E 3"
    const ep = label.match(/E\s*(\d+)/i)?.[1] || $(el).find(".num-epi").text().match(/x(\d+)/)?.[1];
    const thumb = $(el).find("img").first().attr("src") || "";
    const image = /^https?:\/\//.test(thumb) ? thumb : undefined;
    out.push({
      title: ep ? `Episode ${ep}` : label || `Episode ${out.length + 1}`,
      link: absolute(base, href),
      type: "series",
      ...(image ? { image } : {}),
    });
  });
  return out;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { cheerio } = providerContext;
    const base = await getBase(providerContext);
    const html = await getHtml(providerContext, link);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().replace(/\s+/g, " ").trim();
    // The site sometimes appends junk after the extension ("….jpgfV.jpg").
    const image = (
      $('meta[property="og:image"]').attr("content") ||
      $(".bghd img, .post-thumbnail img").first().attr("src") ||
      $("img[src*='image.tmdb.org']").first().attr("src") ||
      ""
    ).replace(/(\.(?:jpg|png|webp))[^/]*$/i, "$1");
    const description = $(".description").first();
    const synopsis = description
      .find("p")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const tags = [
      ...description
        .text()
        .match(/Language:\s*([^\n]+)/)?.[1]
        ?.split(/[–-]/)
        .map((t) => t.trim()) || [],
    ].filter(Boolean);

    const isMovie = link.includes("/movies/");
    const linkList: Link[] = [];
    if (isMovie) {
      linkList.push({
        title: "Movie",
        directLinks: [{ title: "Movie", link, type: "movie" }],
      });
    } else {
      const seasons = $("a.season-btn")
        .map((_, el) => ({
          name: $(el).text().replace(/\s+/g, " ").trim(),
          url: $(el).attr("data-url") || "",
        }))
        .get()
        .filter((s: { name: string; url: string }) => s.url);
      if (seasons.length > 0) {
        const lists = await Promise.all(
          seasons.map((s: { name: string; url: string }) =>
            getHtml(providerContext, absolute(base, s.url), undefined, link)
              .then((h) => parseEpisodes(providerContext, base, h))
              .catch(() => []),
          ),
        );
        seasons.forEach((s: { name: string; url: string }, i: number) => {
          if (lists[i].length) linkList.push({ title: s.name, directLinks: lists[i] });
        });
      }
      if (linkList.length === 0) {
        const eps = parseEpisodes(providerContext, base, html);
        if (eps.length) linkList.push({ title: "Episodes", directLinks: eps });
      }
    }

    return {
      title,
      synopsis,
      image,
      imdbId: "",
      type: isMovie ? "movie" : "series",
      tags,
      webUrl: link,
      linkList,
    };
  } catch (err) {
    throwProviderError("ToonStream", "metadata", err);
  }
};
