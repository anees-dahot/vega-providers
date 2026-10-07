import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { api, titleOf } from "./common";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const [m, eps] = await Promise.all([
      api(providerContext, `anime/${encodeURIComponent(link)}`),
      api(providerContext, `anime/${encodeURIComponent(link)}/episodes?limit=10000`).catch(
        () => ({ data: [] }),
      ),
    ]);
    const isMovie = m.format === "MOVIE";
    const episodes: any[] = (eps?.data || []).filter(
      (e: any) => e?.episode_number && e.kind !== "special",
    );
    const directLinks: NonNullable<Link["directLinks"]> = (
      episodes.length
        ? episodes
        : Array.from({ length: m.episode_count || (isMovie ? 1 : 0) }, (_, i) => ({
            episode_number: i + 1,
          }))
    ).map((e: any) => ({
      title: isMovie ? "Movie" : `Episode ${e.episode_number}`,
      link: `${link}:${e.episode_number}`,
      type: isMovie ? "movie" : "series",
      ...(e.title && !isMovie ? { description: e.title } : {}),
      ...(e.thumbnail_url ? { image: e.thumbnail_url } : {}),
      ...(e.canon_type === "filler" ? { filler: true } : {}),
      ...(Array.isArray(e.skip_times) && e.skip_times.length
        ? {
            skip: e.skip_times.map((s: any) => ({
              title: s.kind === "op" ? "Intro" : s.kind === "ed" ? "Outro" : s.kind,
              from: s.start_seconds,
              to: s.end_seconds,
            })),
          }
        : {}),
    }));

    return {
      title: titleOf(m),
      synopsis: String(m.description || "").replace(/<[^>]+>/g, "").trim(),
      image: m.cover_url || "",
      ...(m.banner_url || m.background_url ? { poster: m.banner_url || m.background_url } : {}),
      ...(m.logo_url ? { logo: m.logo_url } : {}),
      imdbId: m.external_ids?.imdb?.[0] || "",
      type: isMovie ? "movie" : "series",
      tags: m.genres || [],
      ...(m.average_score ? { rating: (m.average_score / 10).toFixed(1) } : {}),
      linkList: [{ title: isMovie ? "Movie" : "Episodes", directLinks }],
    };
  } catch (err) {
    throwProviderError("Miruro", "metadata", err);
  }
};
