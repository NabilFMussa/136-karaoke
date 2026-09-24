import type { LyricsDocument, LyricsMatch, TimedLyricLine } from "@karaoke/shared";

const apiBase = "https://lrclib.net/api";
const cacheDurationMs = 5 * 60_000;
const requestSpacingMs = 500;
const cache = new Map<string, { expiresAt: number; value: unknown }>();
let nextRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

export class LyricsLookupError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface LrclibRecord {
  id?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  duration?: unknown;
  syncedLyrics?: unknown;
  instrumental?: unknown;
}

export function parseTimedLyrics(value: string): TimedLyricLine[] {
  const lines: TimedLyricLine[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = raw.replace(/\[(\d{1,3}):(\d{2})(?:\.\d{1,3})?\]/g, "").trim();
    if (!text || text.length > 300) continue;
    for (const stamp of stamps) {
      const fraction = Number(`0.${(stamp[3] ?? "0").padEnd(3, "0")}`);
      const timeSeconds = Number(stamp[1]) * 60 + Number(stamp[2]) + fraction;
      if (Number.isFinite(timeSeconds)) lines.push({ timeSeconds, text });
    }
  }
  return lines.sort((a, b) => a.timeSeconds - b.timeSeconds).slice(0, 500);
}

function normalizedRecord(value: unknown): LrclibRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LrclibRecord : null;
}

function matchFromRecord(value: unknown): LyricsMatch | null {
  const record = normalizedRecord(value);
  if (!record || !Number.isSafeInteger(record.id) || Number(record.id) < 1 ||
    typeof record.trackName !== "string" || typeof record.artistName !== "string" ||
    typeof record.syncedLyrics !== "string" || !record.syncedLyrics.trim() || record.instrumental === true) return null;
  return {
    id: Number(record.id),
    title: record.trackName,
    artist: record.artistName,
    durationSeconds: typeof record.duration === "number" && Number.isFinite(record.duration) ? record.duration : 0
  };
}

function schedule<T>(work: () => Promise<T>): Promise<T> {
  const queued = requestChain.catch(() => {}).then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try { return await work(); }
    finally { nextRequestAt = Math.max(nextRequestAt, Date.now() + requestSpacingMs); }
  });
  requestChain = queued.catch(() => {});
  return queued;
}

async function getJson(path: string): Promise<unknown> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return schedule(async () => {
    const secondCheck = cache.get(path);
    if (secondCheck && secondCheck.expiresAt > Date.now()) return secondCheck.value;
    const response = await fetch(`${apiBase}${path}`, {
      headers: { "User-Agent": "KaraokeServer/0.1.0 (http://localhost:3000)" },
      signal: AbortSignal.timeout(8_000)
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "10");
      nextRequestAt = Date.now() + Math.min(60, Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 10)) * 1000;
      throw new LyricsLookupError("Lyrics search is rate limited. Try again shortly.", 429);
    }
    if (response.status === 404) throw new LyricsLookupError("These lyrics are no longer available.", 404);
    if (!response.ok) throw new LyricsLookupError("Lyrics service is unavailable. Try again later.", 502);
    const value = await response.json() as unknown;
    cache.set(path, { value, expiresAt: Date.now() + cacheDurationMs });
    return value;
  });
}

export async function searchTimedLyrics(title: string, artist: string): Promise<LyricsMatch[]> {
  const params = artist ? new URLSearchParams({ track_name: title, artist_name: artist }) : new URLSearchParams({ q: title });
  const records = await getJson(`/search?${params}`);
  if (!Array.isArray(records)) throw new LyricsLookupError("Lyrics service returned an invalid response.", 502);
  return records.map(matchFromRecord).filter((item): item is LyricsMatch => item !== null).slice(0, 10);
}

export async function getTimedLyrics(id: number): Promise<LyricsDocument> {
  const record = normalizedRecord(await getJson(`/get/${id}`));
  const match = matchFromRecord(record);
  if (!match || typeof record?.syncedLyrics !== "string") throw new LyricsLookupError("Timed lyrics are unavailable for this match.", 404);
  const lines = parseTimedLyrics(record.syncedLyrics);
  if (!lines.length) throw new LyricsLookupError("Timed lyrics are unavailable for this match.", 404);
  return { ...match, lines };
}
