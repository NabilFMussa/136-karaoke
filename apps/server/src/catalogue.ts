import type { OnlineTrack } from "@karaoke/shared";

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: { title?: string; channelId?: string; channelTitle?: string };
};
type YouTubeSearchResponse = { items?: YouTubeSearchItem[]; error?: { errors?: Array<{ reason?: string }> } };
type YouTubeChannelResponse = { items?: Array<{ id?: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }> };

export const TRUSTED_CHANNELS = [
  { id: "UCwTRjvjVge51X-ILJ4i22ew", name: "Sing King" },
  { id: "UCwXOPyNfdUIhsM4NykfhPFw", name: "CC Karaoke" }
] as const;
const trustedChannelIds = new Set<string>(TRUSTED_CHANNELS.map((channel) => channel.id));
const POPULAR_SUBSCRIBER_THRESHOLD = 250_000;

export class YouTubeSearchError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "YouTubeSearchError";
    this.statusCode = statusCode;
  }
}

export function mapYouTubeResults(items: YouTubeSearchItem[], query: string, subscriberCounts: ReadonlyMap<string, number> = new Map()): OnlineTrack[] {
  const seen = new Set<string>();
  const tracks: OnlineTrack[] = [];
  for (const item of items) {
    const videoId = item.id?.videoId;
    const rawTitle = item.snippet?.title?.trim();
    if (!videoId || !/^[\w-]{11}$/.test(videoId) || !rawTitle || seen.has(videoId)) continue;
    seen.add(videoId);

    const channelId = item.snippet?.channelId;
    const subscriberCount = channelId ? subscriberCounts.get(channelId) : undefined;
    const highlight = channelId && trustedChannelIds.has(channelId) ? "trusted" : subscriberCount !== undefined && subscriberCount >= POPULAR_SUBSCRIBER_THRESHOLD ? "popular" : undefined;
    tracks.push({
      videoId,
      title: rawTitle,
      artist: "",
      brand: (item.snippet?.channelTitle ?? "YouTube").trim().slice(0, 120) || "YouTube",
      source: "youtube",
      searchQuery: query.slice(0, 120),
      ...(channelId ? { channelId } : {}),
      ...(subscriberCount !== undefined ? { subscriberCount } : {}),
      ...(highlight ? { highlight } : {})
    });
  }
  // Keep YouTube's relevance order within each tier, while making trusted
  // channels easier to find than merely popular or unclassified results.
  return [
    ...tracks.filter((track) => track.highlight === "trusted"),
    ...tracks.filter((track) => track.highlight === "popular"),
    ...tracks.filter((track) => !track.highlight)
  ];
}

// Search metadata is cached briefly in memory only; audiovisual content is never downloaded or cached.
const cache = new Map<string, { expires: number; tracks: OnlineTrack[] }>();
const pending = new Map<string, Promise<OnlineTrack[]>>();
const channelCache = new Map<string, { expires: number; subscribers: number | null }>();

async function getSubscriberCounts(channelIds: string[], apiKey: string): Promise<Map<string, number>> {
  const now = Date.now();
  const missing = [...new Set(channelIds)].filter((id) => !channelCache.get(id) || channelCache.get(id)!.expires <= now);
  if (missing.length) {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.search = new URLSearchParams({ key: apiKey, part: "statistics", id: missing.join(",") }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const data = await response.json() as YouTubeChannelResponse;
        const counts = new Map((data.items ?? []).flatMap((item) => {
          const count = Number(item.statistics?.subscriberCount);
          return item.id && !item.statistics?.hiddenSubscriberCount && Number.isFinite(count) && count >= 0 ? [[item.id, count] as const] : [];
        }));
        for (const id of missing) channelCache.set(id, { expires: now + 86_400_000, subscribers: counts.get(id) ?? null });
      }
    } catch {
      // Channel statistics are optional; a failed lookup must not hide playable results.
    }
  }
  return new Map(channelIds.flatMap((id) => {
    const cached = channelCache.get(id);
    return cached && cached.expires > now && cached.subscribers !== null ? [[id, cached.subscribers] as const] : [];
  }));
}

export async function searchCatalogue(query: string): Promise<OnlineTrack[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new YouTubeSearchError("YouTube search is not configured yet. Add YOUTUBE_API_KEY to the project’s .env file and restart the app.", 503);

  const key = query.trim().toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.tracks;
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 4) throw new YouTubeSearchError("YouTube search is busy. Try again shortly.", 503);

  const task = (async () => {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.search = new URLSearchParams({
      key: apiKey,
      part: "snippet",
      type: "video",
      q: /\bkaraoke\b/i.test(query) ? query : `${query} karaoke`,
      videoEmbeddable: "true",
      regionCode: "GB",
      relevanceLanguage: "en",
      safeSearch: "moderate",
      maxResults: "50"
    }).toString();

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    } catch {
      throw new YouTubeSearchError("YouTube search could not be reached. Check the server’s internet connection and try again.", 502);
    }

    const data = await response.json() as YouTubeSearchResponse;
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        throw new YouTubeSearchError("YouTube search has reached its daily limit. Try again tomorrow.", 429);
      }
      if (reason === "keyInvalid" || reason === "accessNotConfigured") {
        throw new YouTubeSearchError("The YouTube API key is invalid or the YouTube Data API has not been enabled for its Google project.", 503);
      }
      throw new YouTubeSearchError("YouTube could not complete the search. Try again shortly.", 502);
    }

    const items = data.items ?? [];
    const subscriberCounts = await getSubscriberCounts(items.flatMap((item) => item.snippet?.channelId ? [item.snippet.channelId] : []), apiKey);
    const tracks = mapYouTubeResults(items, query, subscriberCounts);
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 300_000, tracks });
    return tracks;
  })();

  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
