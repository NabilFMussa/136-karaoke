import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HistoryResponse, OnlineTrack, QueueResponse } from "@karaoke/shared";
import { createApp } from "./app.ts";

async function start(databasePath: string) {
  const app = createApp({ databasePath });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address === "object");
  return { app, url: `http://127.0.0.1:${address.port}` };
}

async function stop(app: ReturnType<typeof createApp>) {
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  app.close();
}

async function json(url: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  });
}

const first: OnlineTrack = { videoId: "ZFg3XnyILPk", title: "Creep karaoke", artist: "Radiohead", brand: "CC Karaoke", source: "youtube" };
const second: OnlineTrack = { videoId: "9iQH7g_zKl8", title: "Never Gonna Give You Up karaoke", artist: "Rick Astley", brand: "Zoom Karaoke", source: "youtube" };

test("queue add, reorder, remove and restart preserve the requested order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "karaoke-queue-"));
  const databasePath = join(directory, "state.sqlite");
  let running = await start(databasePath);
  try {
    for (const [track, singerName] of [[first, "Alex"], [second, "Sam"]] as const) {
      const response = await json(`${running.url}/api/queue`, "POST", { track, singerName });
      assert.equal(response.status, 201);
    }
    const before = await (await fetch(`${running.url}/api/queue`)).json() as QueueResponse;
    assert.deepEqual(before.entries.map(entry => entry.singerName), ["Alex", "Sam"]);

    const ids = before.entries.map(entry => entry.id).reverse();
    const reordered = await json(`${running.url}/api/queue/reorder`, "PATCH", { ids });
    assert.equal(reordered.status, 200);
    assert.deepEqual(((await reordered.json()) as QueueResponse).entries.map(entry => entry.id), ids);

    await stop(running.app);
    running = await start(databasePath);
    const after = await (await fetch(`${running.url}/api/queue`)).json() as QueueResponse;
    assert.deepEqual(after.entries.map(entry => entry.id), ids);

    const removed = await json(`${running.url}/api/queue/${ids[0]}`, "DELETE");
    assert.equal(removed.status, 200);
    const remaining = await (await fetch(`${running.url}/api/queue`)).json() as QueueResponse;
    assert.deepEqual(remaining.entries.map(entry => [entry.id, entry.position]), [[ids[1], 1]]);
  } finally {
    await stop(running.app);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recently played records valid starts, moves replays to the top and survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "karaoke-history-"));
  const databasePath = join(directory, "state.sqlite");
  let running = await start(databasePath);
  try {
    const empty = await (await fetch(`${running.url}/api/history`)).json() as HistoryResponse;
    assert.deepEqual(empty.entries, []);
    const invalid = await json(`${running.url}/api/history`, "POST", { track: { ...first, videoId: "invalid" } });
    assert.equal(invalid.status, 400);

    for (const track of [first, second, first]) {
      const response = await json(`${running.url}/api/history`, "POST", { track });
      assert.equal(response.status, 201);
    }
    const recent = await (await fetch(`${running.url}/api/history`)).json() as HistoryResponse;
    assert.deepEqual(recent.entries.map(entry => entry.videoId), [first.videoId, second.videoId]);
    assert.match(recent.entries[0]!.playedAt, /^\d{4}-\d{2}-\d{2}T/);

    await stop(running.app);
    running = await start(databasePath);
    const after = await (await fetch(`${running.url}/api/history`)).json() as HistoryResponse;
    assert.deepEqual(after.entries.map(entry => entry.videoId), [first.videoId, second.videoId]);
  } finally {
    await stop(running.app);
    rmSync(directory, { recursive: true, force: true });
  }
});
