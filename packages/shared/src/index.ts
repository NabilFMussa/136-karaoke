export interface HealthResponse {
  status: "ok";
  service: "karaoke-server";
  version: string;
  database: "connected";
  timestamp: string;
  uptimeSeconds: number;
}

export interface ApiErrorResponse {
  error: string;
  statusCode: number;
}

export interface OnlineTrack {
  videoId: string;
  title: string;
  artist: string;
  brand: string;
  source: "youtube";
  channelId?: string;
  subscriberCount?: number;
  highlight?: "trusted" | "popular";
  /** Original user query, used to find alternate versions with YouTube search. */
  searchQuery?: string;
}

export interface QueueEntry extends OnlineTrack {
  id: string;
  singerName: string;
  position: number;
  createdAt: string;
}

export interface QueueResponse { entries: QueueEntry[] }

export interface PlayedTrack extends OnlineTrack {
  playedAt: string;
}

export interface HistoryResponse { entries: PlayedTrack[] }

/** Spotify catalogue metadata only; playback remains with YouTube. */
export interface SpotifySong {
  id: string;
  /** The discovery search bucket, not a verified genre tag on the track. */
  genre: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  spotifyUrl: string;
}

export interface SpotifySuggestionsResponse {
  songs: SpotifySong[];
  reason: string;
}

export interface LyricsMatch {
  id: number;
  title: string;
  artist: string;
  durationSeconds: number;
}

export interface TimedLyricLine {
  timeSeconds: number;
  text: string;
}

export interface LyricsDocument extends LyricsMatch {
  lines: TimedLyricLine[];
}

export interface LyricsSearchResponse { matches: LyricsMatch[] }
export interface LyricsResponse { lyrics: LyricsDocument }
