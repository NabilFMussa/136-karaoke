import assert from "node:assert/strict";
import test from "node:test";
import { mapYouTubeResults, searchCatalogue, TRUSTED_CHANNELS } from "./catalogue.ts";

const popularChannelId = "UCpopular1234567890123";
const smallChannelId = "UCsmall12345678901234";

test("broad results retain original titles and distinguish trusted and popular channels", () => {
  const tracks = mapYouTubeResults([
    { id: { videoId: "abcdefghijk" }, snippet: { title: "Hamilton - Satisfied (Karaoke)", channelId: TRUSTED_CHANNELS[0].id, channelTitle: "Sing King" } },
    { id: { videoId: "lmnopqrstuv" }, snippet: { title: "Hamilton - Helpless Karaoke", channelId: popularChannelId, channelTitle: "Popular Channel" } },
    { id: { videoId: "12345678901" }, snippet: { title: "Hamilton - My Shot", channelId: smallChannelId, channelTitle: "Small Channel" } },
    { id: { videoId: "abcdefghijk" }, snippet: { title: "Duplicate", channelId: smallChannelId, channelTitle: "Small Channel" } }
  ], "Hamilton", new Map([[popularChannelId, 300_000], [smallChannelId, 12_000]]));

  assert.deepEqual(tracks.map((track) => track.title), ["Hamilton - Satisfied (Karaoke)", "Hamilton - Helpless Karaoke", "Hamilton - My Shot"]);
  assert.deepEqual(tracks.map((track) => track.highlight), ["trusted", "popular", undefined]);
});

test("search results put trusted channels first, then popular, preserving order within each tier", () => {
  const tracks = mapYouTubeResults([
    { id: { videoId: "aaaaaaaaaaa" }, snippet: { title: "Other first", channelId: smallChannelId } },
    { id: { videoId: "bbbbbbbbbbb" }, snippet: { title: "Popular first", channelId: popularChannelId } },
    { id: { videoId: "ccccccccccc" }, snippet: { title: "Trusted first", channelId: TRUSTED_CHANNELS[0].id } },
    { id: { videoId: "ddddddddddd" }, snippet: { title: "Other second", channelId: smallChannelId } },
    { id: { videoId: "eeeeeeeeeee" }, snippet: { title: "Trusted second", channelId: TRUSTED_CHANNELS[1].id } },
    { id: { videoId: "fffffffffff" }, snippet: { title: "Popular second", channelId: popularChannelId } }
  ], "test", new Map([[popularChannelId, 300_000], [smallChannelId, 12_000], [TRUSTED_CHANNELS[0].id, 1_000_000]]));

  assert.deepEqual(tracks.map((track) => track.title), [
    "Trusted first", "Trusted second", "Popular first", "Popular second", "Other first", "Other second"
  ]);
  assert.deepEqual(tracks.map((track) => track.highlight), ["trusted", "trusted", "popular", "popular", undefined, undefined]);
});

test("an uncached query makes one broad search and one batched channel lookup", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.YOUTUBE_API_KEY;
  const calls: URL[] = [];
  process.env.YOUTUBE_API_KEY = "test-key";
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/search")) return Response.json({ items: [
      { id: { videoId: "abcdefghijk" }, snippet: { title: "Test Song Karaoke", channelId: popularChannelId, channelTitle: "Popular Channel" } },
      { id: { videoId: "lmnopqrstuv" }, snippet: { title: "Test Song - Live", channelId: smallChannelId, channelTitle: "Small Channel" } }
    ] });
    if (url.pathname.endsWith("/channels")) return Response.json({ items: [
      { id: popularChannelId, statistics: { subscriberCount: "1200000", hiddenSubscriberCount: false } },
      { id: smallChannelId, statistics: { subscriberCount: "12000", hiddenSubscriberCount: false } }
    ] });
    throw new Error("Unexpected API request");
  };

  try {
    const tracks = await searchCatalogue("unique broad search test song");
    assert.equal(calls.filter((url) => url.pathname.endsWith("/search")).length, 1);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/channels")).length, 1);
    assert.equal(calls[0]?.searchParams.has("channelId"), false);
    assert.equal(calls[0]?.searchParams.get("maxResults"), "50");
    assert.deepEqual(tracks.map((track) => track.highlight), ["popular", undefined]);
    assert.equal(tracks.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
  }
});
