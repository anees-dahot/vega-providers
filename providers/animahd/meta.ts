import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { cleanTitle, decodeEntities } from "./common";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { axios, cheerio, commonHeaders } = providerContext;
    const res = await axios.get(link, { headers: commonHeaders });
    const $ = cheerio.load(String(res.data));

    const { title, audio } = cleanTitle($(".ff-title").first().text() || $("title").text());
    const image =
      $(".ff-poster-wrap img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "";
    const synopsis = decodeEntities($(".ff-synopsis").text()).replace(/\s+/g, " ").trim();
    const tags = [
      ...$(".ff-genres .ff-pill")
        .map((_, el) => $(el).text().trim())
        .get(),
      ...(audio ? audio.split("-").map((t: string) => t.trim()) : []),
    ].filter(Boolean);

    // Episode rows are grouped by a data-season attribute.
    const seasons = new Map<string, NonNullable<Link["directLinks"]>>();
    $("a.app-ep-row-item").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const season = $(el).attr("data-season") || "Episodes";
      const name = $(el)
        .find(".gdrive-ep-meta > div")
        .first()
        .text()
        .replace(/\[ANIMAHD\]\s*/i, "")
        .replace(/\.(mkv|mp4)$/i, "")
        .trim();
      const quality = $(el).find(".gdrive-ep-meta > div").eq(1).text().split("•")[0].trim();
      const list = seasons.get(season) || [];
      list.push({
        title: name || `Episode ${list.length + 1}`,
        link: decodeEntities(href),
        type: "series",
        ...(quality ? { description: quality } : {}),
      });
      seasons.set(season, list);
    });

    const linkList: Link[] = [...seasons.entries()].map(([name, directLinks]) => ({
      title: name,
      directLinks,
    }));
    const total = [...seasons.values()].reduce((n, l) => n + l.length, 0);
    const isMovie = total === 1 && /movie/i.test(title + " " + $("title").text());

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
    throwProviderError("AnimaHD", "metadata", err);
  }
};
