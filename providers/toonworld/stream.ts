import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { hubcloudExtractor } from "../extractors/hubcloud";
import { gdflixExtractor } from "../extractors/gdflix";
import { getBase, getHtml, parseProps } from "./common";

type Encode = {
  resolution: string;
  readable?: { codec?: string; size?: string };
  files: { host: string; link: string }[];
};

// "/redirect/<token>" → { destination: <shortener>, link: { domain, hidden } };
// the real file link is domain + hidden, so the shortener is never visited.
async function resolveFinalLink(
  providerContext: ProviderContext,
  archiveOrigin: string,
  redirectPath: string,
  referer: string,
  signal?: AbortSignal,
): Promise<string> {
  const html = await getHtml(
    providerContext,
    `${archiveOrigin}${redirectPath}`,
    signal,
    referer,
  );
  const data = parseProps(html);
  const link = data?.link;
  if (!link?.domain || !link?.hidden) throw new Error("No file link in redirect");
  return `${link.domain}${link.hidden}`;
}

export const getStream = async function ({
  link,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    const { axios, cheerio, commonHeaders } = providerContext;
    const archiveOrigin = link.match(/^https?:\/\/[^/]+/)?.[0] || "";
    const base = await getBase(providerContext);

    const html = await getHtml(providerContext, link, signal, `${base}/`);
    const encodes: Encode[] = parseProps(html)?.data?.data?.encodes || [];
    if (encodes.length === 0) throw new Error("No download options on this page");

    const jobs: Promise<Stream[]>[] = [];
    const failures: string[] = [];
    for (const enc of encodes) {
      const resolution = (enc.resolution || "").replace(/p$/i, "");
      const label = enc.readable?.codec || enc.resolution;
      for (const file of enc.files || []) {
        const host = (file.host || "").toLowerCase();
        if (host !== "hubcloud" && host !== "gdflix") continue;
        jobs.push(
          (async () => {
            const finalLink = await resolveFinalLink(
              providerContext,
              archiveOrigin,
              file.link,
              link,
              signal,
            );
            const headers = { ...commonHeaders };
            const streams: Stream[] =
              host === "hubcloud"
                ? await hubcloudExtractor(
                    finalLink,
                    signal as AbortSignal,
                    axios,
                    cheerio,
                    headers,
                    providerContext,
                    isDownload,
                    "toonworld",
                  )
                : await gdflixExtractor(
                    finalLink,
                    signal as AbortSignal,
                    axios,
                    cheerio,
                    headers,
                    providerContext,
                  );
            return (streams || []).map((s) => ({
              ...s,
              server: `${s.server} ${label}`,
              quality: resolution || s.quality,
            }));
          })().catch((e: any) => {
            failures.push(`${file.host} ${label}: ${e?.message}`);
            return [] as Stream[];
          }),
        );
      }
    }

    const out = (await Promise.all(jobs)).flat();
    if (out.length === 0) {
      throw new Error(`No playable source resolved. ${failures.slice(0, 3).join("; ")}`);
    }
    // Best quality first.
    out.sort((a, b) => Number(b.quality) - Number(a.quality));
    return out;
  } catch (err) {
    throwProviderError("ToonWorld", "stream", err);
  }
};
