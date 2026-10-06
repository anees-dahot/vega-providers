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

type Resolved = { finalLink: string; destination: string };

// "/redirect/<token>" → { destination: <ad shortener>, link: { domain, hidden } }.
// The file link is domain + hidden, but the host answers "File Not Found" for
// it until the shortener has been completed (which unlocks 24 hours).
async function resolveRedirect(
  providerContext: ProviderContext,
  archiveOrigin: string,
  redirectPath: string,
  referer: string,
  signal?: AbortSignal,
): Promise<Resolved> {
  const html = await getHtml(
    providerContext,
    `${archiveOrigin}${redirectPath}`,
    signal,
    referer,
  );
  const data = parseProps(html);
  const link = data?.link;
  if (!link?.domain || !link?.hidden) throw new Error("No file link in redirect");
  return { finalLink: `${link.domain}${link.hidden}`, destination: data.destination || "" };
}

async function isLocked(
  providerContext: ProviderContext,
  finalLink: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(finalLink, {
    signal,
    headers: { ...commonHeaders },
    validateStatus: () => true,
    responseType: "text",
    transformResponse: (d: any) => d,
  });
  return res.status === 404 || /file not found/i.test(String(res.data).slice(0, 400));
}

// One dialog at a time: the user completes the shortener once, which unlocks
// every file for 24 hours.
let unlocking: Promise<void> | undefined;

async function unlock(
  providerContext: ProviderContext,
  resolved: Resolved,
  referer: string,
  signal?: AbortSignal,
): Promise<void> {
  const { openWebView, commonHeaders } = providerContext;
  if (typeof openWebView !== "function") {
    throw new Error("ToonWorld links are locked behind ad shorteners and need the app to unlock.");
  }
  if (!unlocking) {
    const target = resolved.finalLink.match(/^https?:\/\/[^/]+/)?.[0] || "";
    unlocking = (async () => {
      await openWebView(resolved.destination, {
        title: "Unlock ToonWorld downloads",
        description:
          "Complete the ads/captcha, then tap Done. This unlocks every download for 24 hours.",
        headers: { ...commonHeaders, Referer: referer },
        // Closes by itself once the shortener lands on the file host.
        injectedJavaScript: `(function(){
          var target = ${JSON.stringify(target)};
          function check(){
            if (target && location.href.indexOf(target) === 0) {
              window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true, data:location.href}));
            }
          }
          check(); setInterval(check, 1000);
        })(); true;`,
        timeoutMs: 600000,
      });
    })().finally(() => {
      unlocking = undefined;
    });
  }
  await unlocking;
  if (await isLocked(providerContext, resolved.finalLink, signal)) {
    throw new Error(
      "ToonWorld links are still locked. Finish the ads in the unlock page (tap Done only after it reaches the download page) and try again.",
    );
  }
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

    const failures: string[] = [];
    type Job = { host: string; label: string; resolution: string; redirect: string };
    const wanted: Job[] = [];
    for (const enc of encodes) {
      for (const file of enc.files || []) {
        const host = (file.host || "").toLowerCase();
        if (host !== "hubcloud" && host !== "gdflix") continue;
        wanted.push({
          host,
          label: enc.readable?.codec || enc.resolution,
          resolution: (enc.resolution || "").replace(/p$/i, ""),
          redirect: file.link,
        });
      }
    }
    if (wanted.length === 0) throw new Error("No supported hosts (HubCloud/GDFlix) on this page");

    const resolved = await Promise.all(
      wanted.map((job) =>
        resolveRedirect(providerContext, archiveOrigin, job.redirect, link, signal)
          .then((r) => ({ job, ...r }))
          .catch((e: any) => {
            failures.push(`${job.host} ${job.label}: ${e?.message}`);
            return null;
          }),
      ),
    );
    const ready = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
    if (ready.length === 0) throw new Error(`No links found. ${failures.slice(0, 3).join("; ")}`);

    // Probe a HubCloud link (GDFlix sits behind Cloudflare, so it can't tell us).
    const probe = ready.find((r) => r.job.host === "hubcloud") || ready[0];
    if (await isLocked(providerContext, probe.finalLink, signal)) {
      await unlock(providerContext, probe, link, signal);
    }

    const jobs: Promise<Stream[]>[] = ready.map(({ job, finalLink }) =>
      (async () => {
        const headers = { ...commonHeaders };
        const streams: Stream[] =
          job.host === "hubcloud"
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
          server: `${s.server} ${job.label}`,
          quality: job.resolution || s.quality,
        }));
      })().catch((e: any) => {
        failures.push(`${job.host} ${job.label}: ${e?.message}`);
        return [] as Stream[];
      }),
    );

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
