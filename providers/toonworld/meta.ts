import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { cleanTitle, getHtml } from "./common";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { cheerio } = providerContext;
    const html = await getHtml(providerContext, link);
    const $ = cheerio.load(html);

    const raw = $("h1.entry-title").first().text() || $("title").first().text();
    const { title, audio } = cleanTitle(raw);
    const image =
      $('meta[property="og:image"]').attr("content") ||
      $("img.wp-post-image").first().attr("src") ||
      "";
    const synopsis = (
      $("p")
        .map((_, p) => $(p).text().trim())
        .get()
        .find((t: string) => /^synopsis\s*:/i.test(t)) ||
      $('meta[property="og:description"]').attr("content") ||
      ""
    )
      .replace(/^synopsis\s*:\s*/i, "")
      .trim();

    const linkList: Link[] = [];
    const items = $(".mks_accordion_item");
    if (items.length > 0) {
      // Episodes sit in accordions; a "SEASON n" line precedes each block.
      $(".mks_accordion").each((i, block) => {
        const label =
          $(block)
            .prevAll("p")
            .map((_, p) => $(p).text().trim())
            .get()
            .find((t: string) => /season\s*\d+/i.test(t)) || "";
        const season = label
          .match(/season\s*\d+/i)?.[0]
          .replace(/\s+/, " ")
          .toLowerCase()
          .replace(/^./, (c: string) => c.toUpperCase());
        const directLinks: NonNullable<Link["directLinks"]> = [];
        $(block)
          .find(".mks_accordion_item")
          .each((_, item) => {
            const name = $(item).find(".mks_accordion_heading strong").text().trim();
            const href = $(item).find("a.mks_button, a[href*='archive.']").first().attr("href");
            if (href) {
              directLinks.push({
                title: name || `Episode ${directLinks.length + 1}`,
                link: href,
                type: "series",
              });
            }
          });
        if (directLinks.length) {
          linkList.push({
            title: season || `Episodes${i ? ` ${i + 1}` : ""}`,
            directLinks,
          });
        }
      });
    } else {
      const href = $("a[href*='archive.toonworld4all.me']").first().attr("href");
      if (href) {
        linkList.push({
          title: "Movie",
          directLinks: [{ title: "Movie", link: href, type: "movie" }],
        });
      }
    }

    // Movies also use an accordion ("Single Download Links"), but their
    // links point at the archive's /movie/ pages.
    const allLinks = linkList.flatMap((l) => l.directLinks || []);
    const isMovie =
      allLinks.length > 0 && allLinks.every((d) => /\/movie\//.test(d.link));
    if (isMovie) {
      linkList.splice(0, linkList.length, {
        title: "Movie",
        directLinks: [{ title: "Movie", link: allLinks[0].link, type: "movie" }],
      });
    }
    return {
      title,
      synopsis,
      image,
      imdbId: "",
      type: isMovie ? "movie" : "series",
      tags: audio ? audio.split("-").map((t: string) => t.trim()).filter(Boolean) : [],
      webUrl: link,
      linkList,
    };
  } catch (err) {
    throwProviderError("ToonWorld", "metadata", err);
  }
};
