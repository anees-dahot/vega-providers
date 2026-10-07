import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { megaplayExtractor } from "../extractors/megaplay";

const PLAYER = "https://megaplay.buzz/stream/mal";

// `link` is "<malId>:<episode>"; sub and dub are tried side by side.
export const getStream = async function ({
  link,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    const [malId, episode] = link.split(":");
    if (!malId || !episode) throw new Error("Invalid episode link");
    const results = await Promise.all(
      ["sub", "dub"].map((audio) =>
        megaplayExtractor(
          providerContext,
          `${PLAYER}/${malId}/${episode}/${audio}`,
          audio,
          "https://gogoanime.me.uk/",
          signal,
        )
          .then((s) => (s ? { ...s, server: `MegaPlay (${audio.toUpperCase()})` } : null))
          .catch(() => null),
      ),
    );
    const streams = results.filter((s): s is Stream => s !== null);
    if (streams.length === 0) throw new Error("No sub or dub stream for this episode yet");
    return streams;
  } catch (err) {
    throwProviderError("Gogoanime", "stream", err);
  }
};
