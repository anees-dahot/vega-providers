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
let unlocking: Promise<string> | undefined;

/** Opens the shortener for the user; resolves with where the page ended up. */
async function unlock(
  providerContext: ProviderContext,
  resolved: Resolved,
  referer: string,
): Promise<string> {
  const { openWebView, commonHeaders } = providerContext;
  if (typeof openWebView !== "function") {
    throw new Error("ToonWorld links are locked behind ad shorteners and need the app to unlock.");
  }
  if (!unlocking) {
    const fileHost = resolved.finalLink.match(/^https?:\/\/[^/]+/)?.[0] || "";
    const site = referer.match(/^https?:\/\/[^/]+/)?.[0] || "";
    unlocking = (async () => {
      const result = await openWebView(resolved.destination, {
        title: "Unlock ToonWorld downloads",
        description:
          "Complete the ads/captcha until a download page opens; it closes by itself. Unlocks 24 hours.",
        headers: { ...commonHeaders, Referer: referer },
        // Done once the shortener hands over to the file host or back to the site.
        injectedJavaScript: `(function(){
          var ends = ${JSON.stringify([fileHost, site].filter(Boolean))};
          function check(){
            for (var i = 0; i < ends.length; i++) {
              if (location.href.indexOf(ends[i]) === 0) {
                window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true, data:"END " + location.href}));
                return;
              }
            }
          }
          check(); setInterval(check, 1000);
        })(); true;`,
        timeoutMs: 900000,
      });
      const data = String(result?.data || "");
      return data.startsWith("END ") ? data.slice(4) : "";
    })().finally(() => {
      unlocking = undefined;
    });
  }
  return unlocking;
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
    let probe = ready.find((r) => r.job.host === "hubcloud") || ready[0];
    if (await isLocked(providerContext, probe.finalLink, signal)) {
      const endedAt = await unlock(providerContext, probe, link);
      // The unlock applies to links handed out after it, so ask again.
      const fresh = await Promise.all(
        ready.map(({ job }) =>
          resolveRedirect(providerContext, archiveOrigin, job.redirect, link, signal)
            .then((r) => ({ job, ...r }))
            .catch(() => null),
        ),
      );
      fresh.forEach((r, i) => {
        if (r) ready[i] = r;
      });
      probe = ready.find((r) => r.job.host === "hubcloud") || ready[0];
      let stillLocked = await isLocked(providerContext, probe.finalLink, signal);
      // The page the shortener ended on may be the unlocked file itself.
      if (
        stillLocked &&
        endedAt &&
        endedAt.startsWith(probe.finalLink.match(/^https?:\/\/[^/]+/)?.[0] || "-") &&
        !(await isLocked(providerContext, endedAt, signal).catch(() => true))
      ) {
        probe.finalLink = endedAt;
        stillLocked = false;
      }
      if (stillLocked) {
        throw new Error(
          `ToonWorld links are still locked after the unlock page${
            endedAt ? ` (it ended at ${endedAt})` : " (it was closed before reaching a download page)"
          }.`,
        );
      }
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
