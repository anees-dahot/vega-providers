import { EpisodeLink, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { img, tmdb } from "./common";

// url is "<tvId>/<season>" from meta.ts.
export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const [id, season] = url.split("/");
    const d = await tmdb(providerContext, `/tv/${id}/season/${season}`);
    const today = new Date().toISOString().slice(0, 10);
    return (d.episodes || [])
      .filter((e: any) => !e.air_date || e.air_date <= today)
      .map((e: any) => ({
        title: `E${e.episode_number}${e.name ? ` - ${e.name}` : ""}`,
        link: `tv/${id}/${season}/${e.episode_number}`,
        ...(e.still_path ? { image: img(e.still_path, "w300") } : {}),
        ...(e.overview ? { description: e.overview } : {}),
      }));
  } catch (err) {
    throwProviderError("Flixbaba", "episodes", err);
  }
};
