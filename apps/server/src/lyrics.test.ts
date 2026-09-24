import assert from "node:assert/strict";
import test from "node:test";
import { getTimedLyrics, parseTimedLyrics, searchTimedLyrics } from "./lyrics.ts";

test("LRC timestamps are parsed and sorted without keeping metadata or empty lines", () => {
  assert.deepEqual(parseTimedLyrics("[ar:Example]\n[00:02.50]Second\n[00:01.25][00:03.00]First\n[00:04.00]"), [
    { timeSeconds: 1.25, text: "First" },
    { timeSeconds: 2.5, text: "Second" },
    { timeSeconds: 3, text: "First" }
  ]);
});

test("lyrics search offers synced matches and loads selected timed lines", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const record = {
      id: 987654321,
      trackName: "Test Song",
      artistName: "Test Artist",
      duration: 205,
      syncedLyrics: "[00:01.00]First line\n[00:02.50]Second line",
      instrumental: false
    };
    return Response.json(url.includes("/search?") ? [record, { ...record, id: 2, syncedLyrics: null }] : record);
  };
  try {
    const matches = await searchTimedLyrics("Test Song", "Test Artist");
    assert.deepEqual(matches, [{ id: 987654321, title: "Test Song", artist: "Test Artist", durationSeconds: 205 }]);
    const lyrics = await getTimedLyrics(matches[0]!.id);
    assert.deepEqual(lyrics.lines, [
      { timeSeconds: 1, text: "First line" },
      { timeSeconds: 2.5, text: "Second line" }
    ]);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /track_name=Test\+Song/);
    assert.match(calls[1]!, /\/get\/987654321$/);
    const broadMatches = await searchTimedLyrics("Test Artist - Test Song", "");
    assert.equal(broadMatches[0]?.title, "Test Song");
    assert.match(calls[2]!, /\/search\?q=Test\+Artist/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
