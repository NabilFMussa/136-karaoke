import assert from "node:assert/strict";
import test from "node:test";
import { mapSpotifyTrack, SpotifyCatalogue, SpotifyError } from "./spotify.ts";

const spotifyId = "ABCDEFGHIJKLMNOPQRSTUV";
const labels = ["Rap", "Rock", "Pop", "R&B", "Dance", "Country"];

function track(id: string, title: string, artist = "Test Artist") {
  return { id, name: title, artists: [{ name: artist }], album: { name: "Test Album", images: [{ url: "https://i.scdn.co/image/test-art" }] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` } };
}

test("Spotify discovery draws fresh genre-diverse picks from cached search pools", async () => {
  const calls: URL[] = [];
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "accounts.spotify.com") return Response.json({ access_token: "test-token", expires_in: 3600 });
    const genre = url.searchParams.get("q") ?? "";
    const index = ["genre:rap", "genre:rock", "genre:pop", 'genre:"r&b"', "genre:dance", "genre:country"].indexOf(genre);
    assert.notEqual(index, -1);
    return Response.json({ tracks: { items: [track("ABCDEF"[index]!.repeat(22), `Song ${index}a`), track("GHIJKL"[index]!.repeat(22), `Song ${index}b`)] } });
  };
  const catalogue = new SpotifyCatalogue(request, () => ({ id: "client-id", secret: "client-secret" }), () => 0);
  const first = await catalogue.suggestions();
  assert.equal(first.songs.length, 6);
  assert.deepEqual(first.songs.map(song => song.genre), labels);
  assert.equal(first.songs[0]?.coverUrl, "https://i.scdn.co/image/test-art");
  assert.equal(calls.length, 7);
  const second = await catalogue.suggestions();
  assert.equal(second.songs.length, 6);
  assert.ok(second.songs.every((song, index) => song.id !== first.songs[index]?.id));
  assert.equal(calls.length, 7, "shuffling must not call Spotify again while pools are cached");
});

test("Spotify stays optional and rejects unsafe artwork URLs", async () => {
  const catalogue = new SpotifyCatalogue(fetch, () => ({ id: "", secret: "" }));
  await assert.rejects(catalogue.suggestions(), error => error instanceof SpotifyError && error.statusCode === 503);
  const mapped = mapSpotifyTrack({ ...track(spotifyId, "No Scrubs"), album: { name: "Test", images: [{ url: "https://example.com/cover.jpg" }] } });
  assert.equal(mapped?.coverUrl, null);
});
