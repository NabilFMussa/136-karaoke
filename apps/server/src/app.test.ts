import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { HealthResponse } from "@karaoke/shared";
import { createApp } from "./app.ts";

test("GET /api/health confirms service and SQLite readiness", async () => {
  const app = createApp({ databasePath: ":memory:", version: "test" });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");

  try {
    const address = app.server.address();
    assert(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = (await response.json()) as HealthResponse;

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.database, "connected");
    assert.equal(body.version, "test");
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.close();
  }
});

test("unknown API routes return a JSON 404", async () => {
  const app = createApp({ databasePath: ":memory:" });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");

  try {
    const address = app.server.address();
    assert(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "API route not found", statusCode: 404 });

    const retiredLyrics = await fetch(`http://127.0.0.1:${address.port}/api/lyrics/search?title=Example`);
    assert.equal(retiredLyrics.status, 404);
    assert.deepEqual(await retiredLyrics.json(), { error: "API route not found", statusCode: 404 });

    if (!process.env.SPOTIFY_CLIENT_ID && !process.env.SPOTIFY_CLIENT_SECRET) {
      const spotify = await fetch(`http://127.0.0.1:${address.port}/api/spotify/suggestions`);
      assert.equal(spotify.status, 503);
    }
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.close();
  }
});
