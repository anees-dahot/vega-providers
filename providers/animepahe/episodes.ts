import { EpisodeLink, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { MINUTE, cached, requestShow } from "./common";

// meta.ts already lists every episode; this stays for older installs that
// still follow an episodesLink.
export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    return await cached(providerContext, `eps:${url}`, 10 * MINUTE, async () => {
      const { pages } = await requestShow(providerContext, url);
      const episodes: EpisodeLink[] = [];
      for (const pageData of pages) {
        for (const ep of pageData?.data || []) {
          if (!ep.session) continue;
          episodes.push({
            title: `Episode ${ep.episode}`,
            link: `${url}/${ep.session}`,
            ...(ep.filler ? { filler: true } : {}),
          });
        }
      }
      return episodes;
    });
  } catch (err) {
    throwProviderError("AnimePahe", "episodes", err);
  }
};
