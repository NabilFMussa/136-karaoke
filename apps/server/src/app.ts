import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiErrorResponse, HealthResponse } from "@karaoke/shared";
import type { OnlineTrack } from "@karaoke/shared";
import { assertDatabaseConnected, openDatabase } from "./database.ts";
import { listRecentPlays, recordPlay } from "./history.ts";
import { searchCatalogue, YouTubeSearchError } from "./catalogue.ts";
import { addQueueEntry, listQueue, removeQueueEntry, reorderQueue } from "./queue.ts";
import { spotifyCatalogue, SpotifyError } from "./spotify.ts";

export interface AppOptions {
  databasePath: string;
  webRoot?: string;
  version?: string;
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > 16_384) throw new Error("Request body is too large.");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16_384) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveStaticFile(webRoot: string, requestPath: string): string | null {
  const root = resolve(webRoot);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const candidate = resolve(root, normalize(relativePath));

  if (!candidate.startsWith(`${root}\\`) && !candidate.startsWith(`${root}/`) && candidate !== root) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  const fallback = join(root, "index.html");
  return existsSync(fallback) ? fallback : null;
}

export function createApp(options: AppOptions): { server: Server; close: () => void } {
  const database = openDatabase(options.databasePath);
  const version = options.version ?? "0.1.0";
  const webRoot = options.webRoot;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === "/api/catalogue/search") {
      const query = (requestUrl.searchParams.get("q") ?? "").trim();
      if (query.length < 2 || query.length > 120) {
        sendJson(response, 400, { error: "Enter between 2 and 120 characters.", statusCode: 400 });
        return;
      }
      try {
        sendJson(response, 200, { tracks: await searchCatalogue(query) });
      } catch (error) {
        const statusCode = error instanceof YouTubeSearchError ? error.statusCode : 502;
        const message = error instanceof Error ? error.message : "YouTube search is unavailable. Try again shortly.";
        sendJson(response, statusCode, { error: message, statusCode });
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/queue") {
      sendJson(response, 200, { entries: listQueue(database.connection) });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/spotify/suggestions") {
      try {
        sendJson(response, 200, await spotifyCatalogue.suggestions());
      } catch (error) {
        const statusCode = error instanceof SpotifyError ? error.statusCode : 502;
        const message = error instanceof Error ? error.message : "Spotify discovery is unavailable.";
        sendJson(response, statusCode, { error: message, statusCode });
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/history") {
      sendJson(response, 200, { entries: listRecentPlays(database.connection) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/history") {
      try {
        const body = await readJsonBody(request);
        const track = isRecord(body) && isRecord(body.track) ? body.track : null;
        const videoId = track && typeof track.videoId === "string" ? track.videoId : "";
        const title = track && typeof track.title === "string" ? track.title.trim() : "";
        const artist = track && typeof track.artist === "string" ? track.artist.trim() : "";
        const brand = track && typeof track.brand === "string" ? track.brand.trim() : "";
        if (!/^[\w-]{11}$/.test(videoId) || title.length < 1 || title.length > 200 || artist.length > 200 || brand.length > 100) {
          sendJson(response, 400, { error: "Choose a valid song to record.", statusCode: 400 });
          return;
        }
        const entry = recordPlay(database.connection, { videoId, title, artist, brand, source: "youtube" });
        sendJson(response, 201, { entry });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save this song.";
        const status = message === "Request body is too large." ? 413 : 400;
        sendJson(response, status, { error: message === "Unexpected end of JSON input" ? "A valid JSON body is required." : message, statusCode: status });
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/queue") {
      try {
        const body = await readJsonBody(request);
        const track = isRecord(body) && isRecord(body.track) ? body.track : null;
        const singerName = isRecord(body) && typeof body.singerName === "string" ? body.singerName.trim() : "";
        const videoId = track && typeof track.videoId === "string" ? track.videoId : "";
        const title = track && typeof track.title === "string" ? track.title.trim() : "";
        const artist = track && typeof track.artist === "string" ? track.artist.trim() : "";
        const brand = track && typeof track.brand === "string" ? track.brand.trim() : "";
        if (!/^[\w-]{11}$/.test(videoId) || title.length < 1 || title.length > 200 || artist.length > 200 || brand.length > 100 || singerName.length < 1 || singerName.length > 60) {
          sendJson(response, 400, { error: "Choose a valid song and enter a singer name (up to 60 characters).", statusCode: 400 });
          return;
        }
        const entry = addQueueEntry(database.connection, { videoId, title, artist, brand, source: "youtube" }, singerName);
        sendJson(response, 201, { entry });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not add the song to the queue.";
        const status = message === "Request body is too large." ? 413 : 400;
        sendJson(response, status, { error: message === "Unexpected end of JSON input" ? "A valid JSON body is required." : message, statusCode: status });
      }
      return;
    }

    if (request.method === "PATCH" && requestUrl.pathname === "/api/queue/reorder") {
      try {
        const body = await readJsonBody(request);
        const ids = isRecord(body) && Array.isArray(body.ids) && body.ids.every(id => typeof id === "string") ? body.ids as string[] : null;
        if (!ids || ids.length > 500) {
          sendJson(response, 400, { error: "Provide the ordered queue entry IDs.", statusCode: 400 });
          return;
        }
        sendJson(response, 200, { entries: reorderQueue(database.connection, ids) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not reorder the queue.";
        sendJson(response, 409, { error: message, statusCode: 409 });
      }
      return;
    }

    const queueEntryMatch = requestUrl.pathname.match(/^\/api\/queue\/([^/]+)$/);
    if (request.method === "DELETE" && queueEntryMatch) {
      const id = decodeURIComponent(queueEntryMatch[1]!);
      if (!/^[\da-f-]{36}$/i.test(id)) {
        sendJson(response, 400, { error: "Invalid queue entry ID.", statusCode: 400 });
      } else if (removeQueueEntry(database.connection, id)) {
        sendJson(response, 200, { removed: true });
      } else {
        sendJson(response, 404, { error: "Queue entry not found.", statusCode: 404 });
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      try {
        assertDatabaseConnected(database.connection);
        sendJson(response, 200, {
          status: "ok",
          service: "karaoke-server",
          version,
          database: "connected",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime())
        });
      } catch {
        sendJson(response, 503, { error: "Database is unavailable", statusCode: 503 });
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API route not found", statusCode: 404 });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed", statusCode: 405 });
      return;
    }

    if (!webRoot) {
      sendJson(response, 404, { error: "Web UI is served by Vite in development", statusCode: 404 });
      return;
    }

    const staticFile = resolveStaticFile(webRoot, requestUrl.pathname);
    if (!staticFile) {
      sendJson(response, 404, { error: "Page not found", statusCode: 404 });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[extname(staticFile)] ?? "application/octet-stream",
      "Cache-Control": extname(staticFile) === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(staticFile).pipe(response);
    }
  });

  return {
    server,
    close: () => database.connection.close()
  };
}

export function defaultWebRoot(): string {
  return fileURLToPath(new URL("../../web/dist", import.meta.url));
}
