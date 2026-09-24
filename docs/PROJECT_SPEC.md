# Karaoke Server — Project Specification

## 1. Product goal

Build a self-hosted karaoke web app with a modern streaming-service feel. Guests discover karaoke songs online, the host manages a singer queue, and a TV plays selected videos. Development is on Windows 11; deployment is planned for an existing Ubuntu 24.04 server running Docker.

## 2. Product principles

- **Online-first media:** do not download, store, or mount song audio/video on the server. Catalogue search and playback require internet access.
- **In-app playback:** keep the player in the app and offer alternate versions when an owner blocks embedding. Provider restrictions cannot be bypassed.
- **Purpose-built screens:** mobile guest search at `/`, player at `/player`, and planned host controls at `/admin`.
- **Cross-platform:** no hard-coded Windows paths or platform-specific application logic.
- **Protect existing infrastructure:** deploy as a separate Compose application without modifying the existing media stack.
- **Progressive delivery:** verify each milestone before expanding scope.

## 3. Current implementation

- React/TypeScript web UI, Node/TypeScript API, shared types, and SQLite app-state foundation.
- `GET /api/health` for service/database status.
- `GET /api/catalogue/search?q=...` for one broad online karaoke search via the official YouTube Data API v3, requesting embeddable videos. Search results retain their original YouTube titles; Sing King, CC Karaoke, and channels with at least 250,000 visible subscribers are highlighted rather than required.
- `/player` uses the YouTube IFrame Player API; users can switch matching versions without opening a new app tab.
- The singer queue persists song metadata, singer name, YouTube video ID, and order in SQLite. Guests can add entries; queue controls can reorder or remove them. The landing page refreshes queue state periodically.
- Recently played stores only song metadata and playback time in SQLite after the embedded video starts. Replays move that version to the top; the landing page links back to its player. The development database was backed up before this schema change.
- Optional Spotify catalogue discovery uses server-side client credentials to select a random song from each of six genre searches: rap, rock, pop, R&B, dance, and country. Spotify search pools are cached for an hour and the six picks change on reload or shuffle. The genre labels identify search buckets, not verified track genres. Spotify artwork stays unmodified and links back to the track on Spotify; videos still come from YouTube. Without credentials, the rest of the app remains usable.
- Separate synced lyrics are paused: LRCLIB timings did not reliably align with karaoke uploads. The player now relies on lyrics embedded in the selected YouTube video or its native captions. The prototype source is retained, but its UI is not mounted and its API routes are disabled, so playback makes no LRCLIB requests.
- Docker/Compose build with persistent SQLite data only. No media mount or local library scanner.

Search requires a server-side `YOUTUBE_API_KEY`. Results are metadata for YouTube videos marked embeddable; that flag is not a playback guarantee. YouTube owner restrictions, Content ID claims, removed videos, ads, regional limits, and browser policies may still prevent a particular video from playing in an embed. Search uses YouTube's quota-limited API, so the server briefly caches repeated searches. Do not bypass provider restrictions or download media as a fallback.

## 4. Planned flows

1. A guest opens the app on their phone and searches for a song or artist.
2. The guest chooses an embeddable version and later adds it under a singer name to a queue.
3. A host manages the queue and directs the selected item to the TV player.
4. The guest can revisit recently played songs or shuffle six genre-diverse Spotify-backed song ideas.
5. The TV plays the online video inside the app and shows the next singer between songs.

Search, same-device playback, a persistent singer queue, recently played, and optional Spotify-backed discovery are implemented. Remote TV control and `/admin` are future work.

The interface uses a dark, music-library-inspired visual system with artwork-led discovery, a compact navigation rail, and a focused player with alternate versions alongside the video. Starting a search switches from the home dashboard to a dedicated results view with a visible loading indicator; the search field remains available to start another search.

## 5. Architecture and storage

| Area | Choice | Use |
|---|---|---|
| Web UI | React, TypeScript, Vite | Search and in-app player |
| API | Node.js 24, TypeScript | YouTube Data API adapter and health endpoint |
| App state | SQLite at `/data/karaoke.sqlite` in Docker | Settings and queued song metadata/order; **no media files** |
| Playback | YouTube IFrame Player API | Direct browser-to-provider stream |
| Packaging | Docker and Compose | Consistent Windows/Linux runtime |

Development uses Vite on port 5173 and the API on port 3001. The production image serves both from port 3000. Compose persists only the database directory. Search responses may be briefly cached in server memory; audio and video are not cached on disk. The API key is read only by the server and must never be placed in frontend code.

## 6. Roadmap

1. **Foundation (done):** workspace, web UI, API, SQLite, Docker/Compose configuration, health endpoint.
2. **Online discovery (preview):** catalogue search, version selection, in-app YouTube playback, visible failure states.
3. **Playback validation:** confirm real playback for embeddable examples in supported browsers; handle provider failures gracefully.
4. **Singer queue (implemented):** add, remove, reorder, and persist requests referencing online video IDs.
5. **Recently played songs (implemented):** persist playback history as song metadata in SQLite and provide a quick way to replay a prior selection.
6. **Synced lyrics (deferred):** the prototype is retained but disconnected. Revisit only if a reliable timing source for the actual karaoke video is available.
7. **Spotify-backed discovery (implemented):** optional random genre-based song ideas with Spotify metadata and covers. The user finds and previews a YouTube karaoke version before adding it to the queue.
8. **TV and host control:** separate player and admin views with live synchronization and an upcoming-singer display.
9. **Polish:** distinctive visual design, QR joining, accessibility, and resilience.

**Future discovery option (not implemented):** let the host connect a Spotify account through the official API and import song titles and artists from accessible playlists. Guests would keep using Karaoke Server without Spotify accounts. This user-authorized playlist flow is separate from the current server-side public catalogue integration. Spotify remains a song index, not an audio or lyrics source; do not scrape Spotify pages or download/proxy media.

Local library scanning, MP3+CDG pairing, transcoding, and media mounts are deferred out of current scope. They would require a fresh user decision before implementation.

## 7. Acceptance and operational boundaries

- `pnpm dev` starts the web and API, and the web UI loads.
- `GET /api/health` confirms API and SQLite access.
- Search returns validated provider video IDs and handles upstream failure explicitly.
- Guests can add a validated online track under a singer name; SQLite preserves the queue across restarts; entries can be removed or reordered.
- A supported, embeddable video plays within `/player`; a blocked video offers other versions on the same page.
- Recently played entries are recorded from playback activity, stored as metadata in SQLite, and can be replayed; no media is stored.
- The player shows no separate synced-lyrics panel and does not call an external lyrics service during normal use. YouTube's own video lyrics and captions remain available.
- Spotify-backed song ideas can be opened to find a YouTube karaoke version for preview and queueing; neither provider's audio or video is downloaded or cached.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `docker compose up --build` exposes the app on port 3000 when Docker is available. Docker runtime validation is still outstanding on this Windows machine.
- No media directory is mounted, no media is downloaded, and the Ubuntu server is not contacted or modified during development.
- Keep API inputs validated, run the container as non-root, and back up SQLite before future schema upgrades.
