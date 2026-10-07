import { ProviderContext } from "../types";

// Listings and details come from AniList; streams come from MegaPlay by
// MyAnimeList id (the player gogoanime.me.uk uses).
export async function anilist(
  providerContext: ProviderContext,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const res = await providerContext.axios.post(
    "https://graphql.anilist.co",
    { query, variables },
    {
      signal,
      timeout: 15000,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    },
  );
  if (res.data?.errors?.length) throw new Error(res.data.errors[0].message);
  return res.data?.data;
}

export const titleOf = (m: any): string =>
  m?.title?.english || m?.title?.romaji || m?.title?.native || "";
