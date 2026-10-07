import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { decodeEntities, getBase, getHtml, getJson, restUrl } from "./common";

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
    let html = await getHtml(providerContext, link);

    // Listings link to an episode page; the show page has the details.
    let $ = cheerio.load(html);
    const showUrl =
      $("a[href*='/anime/']")
        .map((_, el) => $(el).attr("href") || "")
        .get()
        .find((h: string) => /\/anime\/[^/]+\/?$/.test(h) && !/\/feed/.test(h)) || "";
    if (!/\/anime\//.test(link) && showUrl) {
      html = await getHtml(providerContext, showUrl);
      $ = cheerio.load(html);
    }

    const animeId =
      html.match(/"anime_id"\s*:\s*"?(\d+)/)?.[1] ||
      html.match(/anime_id\D{0,5}(\d+)/)?.[1];
    if (!animeId) throw new Error("Could not find the show id");

    const title = decodeEntities(
      $("h2.film-name").first().text() ||
        $('meta[property="og:title"]').attr("content") ||
        "",
    ).replace(/^Watch\s+|\s+All Episodes.*$/gi, "");
    const image = $('meta[property="og:image"]').attr("content") || "";
    const synopsis = decodeEntities(
      $(".film-description .text").first().text() ||
        $('meta[property="og:description"]').attr("content") ||
        "",
    );
    const tags = $(".item-list a[href*='/genre/']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const data = await getJson(providerContext, `${restUrl(base)}/episode/list/${animeId}`);
    const list = cheerio.load(String(data?.html || ""));
    const directLinks: NonNullable<Link["directLinks"]> = [];
    list("a.ep-item").each((_, el) => {
      const id = list(el).attr("data-id");
      if (!id) return;
      const num = list(el).attr("data-number") || String(directLinks.length + 1);
      directLinks.push({ title: `Episode ${num}`, link: id, type: "series" });
    });

    const isMovie = directLinks.length === 1 && /movie/i.test(title);
    return {
      title,
      synopsis,
      image,
      imdbId: "",
      type: isMovie ? "movie" : "series",
      tags,
      webUrl: showUrl || link,
      linkList: [
        {
          title: isMovie ? "Movie" : "Episodes",
          directLinks: isMovie
            ? directLinks.map((d) => ({ ...d, title: "Movie", type: "movie" as const }))
            : directLinks,
        },
      ],
    };
  } catch (err) {
    throwProviderError("AniWatch", "metadata", err);
  }
};
