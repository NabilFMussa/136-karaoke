import type { DatabaseSync } from "node:sqlite";
import type { OnlineTrack, PlayedTrack } from "@karaoke/shared";

export function listRecentPlays(database: DatabaseSync): PlayedTrack[] {
  return database.prepare(`
    SELECT video_id AS videoId, title, artist, brand, 'youtube' AS source,
      played_at AS playedAt
    FROM playback_history ORDER BY id DESC LIMIT 20
  `).all() as unknown as PlayedTrack[];
}

export function recordPlay(database: DatabaseSync, track: OnlineTrack): PlayedTrack {
  const playedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM playback_history WHERE video_id = ?").run(track.videoId);
    database.prepare(`
      INSERT INTO playback_history (video_id, title, artist, brand, played_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(track.videoId, track.title, track.artist, track.brand, playedAt);
    database.prepare(`
      DELETE FROM playback_history WHERE id NOT IN
        (SELECT id FROM playback_history ORDER BY id DESC LIMIT 50)
    `).run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { ...track, playedAt };
}
