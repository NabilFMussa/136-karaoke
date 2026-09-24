import type { SpotifySong, SpotifySuggestionsResponse } from "@karaoke/shared";

type SpotifyTrack = {
  id?: string;
  name?: string;
  artists?: Array<{ id?: string; name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
  external_urls?: { spotify?: string };
};
type SearchResponse = { tracks?: { items?: SpotifyTrack[] } };
type TokenResponse = { access_token?: string; expires_in?: number };
const genres = [
  { label: "Rap", query: "genre:rap" },
  { label: "Rock", query: "genre:rock" },
  { label: "Pop", query: "genre:pop" },
  { label: "R&B", query: 'genre:"r&b"' },
  { label: "Dance", query: "genre:dance" },
  { label: "Country", query: "genre:country" }
] as const;

export class SpotifyError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
}

function safeSpotifyUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "open.spotify.com" ? url.href : null;
  } catch { return null; }
}

function safeCoverUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "i.scdn.co" ? url.href : null;
  } catch { return null; }
}

export function mapSpotifyTrack(track: SpotifyTrack, genre = ""): SpotifySong | null {
  const spotifyUrl = safeSpotifyUrl(track.external_urls?.spotify);
  const artist = track.artists?.map(item => item.name?.trim()).filter(Boolean).join(", ") ?? "";
  if (!track.id || !/^[a-zA-Z0-9]{22}$/.test(track.id) || !track.name?.trim() || !artist || !spotifyUrl) return null;
  return {
    id: track.id,
    genre,
    title: track.name.trim(),
    artist,
    album: track.album?.name?.trim() ?? "",
    coverUrl: safeCoverUrl(track.album?.images?.[0]?.url),
    spotifyUrl
  };
}

export class SpotifyCatalogue {
  private token: { value: string; expiresAt: number } | null = null;
  private pool: { value: Map<string, SpotifySong[]>; expiresAt: number } | null = null;
  private pending: Promise<Map<string, SpotifySong[]>> | null = null;
  private previous = new Map<string, string>();
  private readonly request: typeof fetch;
  private readonly credentials: () => { id: string; secret: string };
  private readonly random: () => number;

  constructor(request: typeof fetch = fetch, credentials = () => ({
    id: process.env.SPOTIFY_CLIENT_ID?.trim() ?? "",
    secret: process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? ""
  }), random: () => number = Math.random) { this.request = request; this.credentials = credentials; this.random = random; }

  configured(): boolean {
    const { id, secret } = this.credentials();
    return Boolean(id && secret);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const { id, secret } = this.credentials();
    if (!id || !secret) throw new SpotifyError("Spotify discovery is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.", 503);
    let response: Response;
    try {
      response = await this.request("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(8000)
      });
    } catch { throw new SpotifyError("Spotify could not be reached. Try again shortly.", 502); }
    if (!response.ok) throw new SpotifyError("Spotify credentials were rejected. Check the client ID and secret.", 503);
    const data = await response.json() as TokenResponse;
    if (!data.access_token || !data.expires_in) throw new SpotifyError("Spotify returned an invalid access token.", 502);
    this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(30, data.expires_in - 60) * 1000 };
    return data.access_token;
  }

  private async get<T>(path: string, parameters?: URLSearchParams): Promise<T> {
    const url = new URL(`https://api.spotify.com/v1/${path}`);
    if (parameters) url.search = parameters.toString();
    const token = await this.accessToken();
    let response: Response;
    try { response = await this.request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }); }
    catch { throw new SpotifyError("Spotify could not be reached. Try again shortly.", 502); }
    if (response.status === 429) throw new SpotifyError("Spotify's discovery limit was reached. Try again later.", 429);
    if (response.status === 401 || response.status === 403) { this.token = null; throw new SpotifyError("Spotify access was denied. Check this app's Spotify developer settings.", 503); }
    if (!response.ok) throw new SpotifyError("Spotify discovery is unavailable. Try again later.", 502);
    return await response.json() as T;
  }

  private async search(query: string): Promise<SpotifyTrack[]> {
    const data = await this.get<SearchResponse>("search", new URLSearchParams({ q: query, type: "track", market: "GB", limit: "10" }));
    return data.tracks?.items ?? [];
  }

  async suggestions(): Promise<SpotifySuggestionsResponse> {
    if (!this.configured()) throw new SpotifyError("Spotify discovery is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.", 503);
    const pools = await this.genrePools();
    const seen = new Set<string>();
    const songs = genres.flatMap(({ label }) => {
      const choices = (pools.get(label) ?? []).filter(song => !seen.has(song.id));
      if (!choices.length) return [];
      // Avoid repeating a genre's previous pick when Spotify supplied alternatives.
      const alternatives = choices.filter(song => song.id !== this.previous.get(label));
      const candidates = alternatives.length ? alternatives : choices;
      const song = candidates[Math.floor(this.random() * candidates.length)] ?? candidates[0]!;
      seen.add(song.id);
      this.previous.set(label, song.id);
      return [song];
    });
    return { songs, reason: "A fresh mix from six Spotify genre searches. Genres describe the search, not a verified tag on each track." };
  }

  private async genrePools(): Promise<Map<string, SpotifySong[]>> {
    if (this.pool && this.pool.expiresAt > Date.now()) return this.pool.value;
    if (this.pending) return this.pending;
    this.pending = this.loadGenrePools();
    try { return await this.pending; } finally { this.pending = null; }
  }

  private async loadGenrePools(): Promise<Map<string, SpotifySong[]>> {
    const pools = new Map<string, SpotifySong[]>();
    for (const { label, query } of genres) {
      pools.set(label, (await this.search(query)).flatMap(track => {
        const song = mapSpotifyTrack(track, label);
        return song ? [song] : [];
      }));
    }
    this.pool = { value: pools, expiresAt: Date.now() + 3_600_000 };
    return pools;
  }
}

export const spotifyCatalogue = new SpotifyCatalogue();
