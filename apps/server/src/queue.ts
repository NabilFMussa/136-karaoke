import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { OnlineTrack, QueueEntry } from "@karaoke/shared";

const queueSelect = `
  SELECT id, video_id AS videoId, title, artist, brand, 'youtube' AS source,
    singer_name AS singerName, position, created_at AS createdAt
  FROM queue_entries ORDER BY position, created_at, id
`;

export function listQueue(database: DatabaseSync): QueueEntry[] {
  return database.prepare(queueSelect).all() as unknown as QueueEntry[];
}

export function addQueueEntry(database: DatabaseSync, track: OnlineTrack, singerName: string): QueueEntry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const nextPosition = database.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS value FROM queue_entries WHERE status = 'queued'").get() as { value: number };
  database.prepare(`
    INSERT INTO queue_entries (id, video_id, title, artist, brand, singer_name, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, track.videoId, track.title, track.artist, track.brand, singerName, nextPosition.value, createdAt);
  return listQueue(database).find(entry => entry.id === id)!;
}

export function removeQueueEntry(database: DatabaseSync, id: string): boolean {
  const result = database.prepare("DELETE FROM queue_entries WHERE id = ?").run(id);
  if (result.changes === 0) return false;
  normalizePositions(database);
  return true;
}

export function reorderQueue(database: DatabaseSync, ids: string[]): QueueEntry[] {
  if (new Set(ids).size !== ids.length) throw new Error("Queue order contains duplicate entries.");
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = (database.prepare("SELECT id FROM queue_entries WHERE status = 'queued' ORDER BY position, created_at, id").all() as Array<{ id: string }>).map(row => row.id);
    if (current.length !== ids.length || current.some(id => !ids.includes(id))) throw new Error("Queue changed. Refresh and try again.");
    const update = database.prepare("UPDATE queue_entries SET position = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index + 1, id));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return listQueue(database);
}

function normalizePositions(database: DatabaseSync): void {
  const ids = (database.prepare("SELECT id FROM queue_entries WHERE status = 'queued' ORDER BY position, created_at, id").all() as Array<{ id: string }>).map(row => row.id);
  const update = database.prepare("UPDATE queue_entries SET position = ? WHERE id = ?");
  ids.forEach((id, index) => update.run(index + 1, id));
}
