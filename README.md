# Karaoke Server

An online-first karaoke web app. Search the online catalogue and play embeddable YouTube karaoke videos in the app without downloading or hosting song files. Development runs on Windows 11; the eventual deployment target is an Ubuntu 24.04 server.

The app supports search, same-page YouTube playback with alternate versions, a persistent singer queue with add, reorder, and remove controls, recently played songs, and optional Spotify-backed song discovery. A song enters recently played when its embedded video starts playing; the landing page provides replay links. Spotify discovery shows a random mix of six genre-based catalogue picks, and selecting one searches for YouTube karaoke versions to preview. It never queues a video automatically. Remote TV synchronization remains future work.

An optional Spotify catalogue row picks one random song each from rap, rock, pop, R&B, dance, and country search results, with album covers and links back to Spotify. The row loads without play history and changes when the page reloads or **Shuffle picks** is pressed. Search pools are cached on the server for an hour to limit Spotify API calls; a genre label identifies the search bucket, not a verified tag on the individual track. This is our own random selection, **not Spotify's recommendation algorithm**. Spotify audio is never played or downloaded by this app.

## Requirements

- Node.js 24 or later and pnpm 11 for development
- Docker Desktop with WSL 2 if you want to test the container workflow on Windows
- Internet access for catalogue search and playback

## Configure YouTube search

Create a Google Cloud API key with YouTube Data API v3 enabled, restrict the key to that API, and put it in the ignored root `.env` file (copy `.env.example` first):

```dotenv
YOUTUBE_API_KEY=your-server-side-key
```

Do not put the key in frontend settings or commit it. Search uses YouTube's quota-limited API. Results marked embeddable can still fail in the player because of owner restrictions, Content ID claims, or other YouTube playback rules.

## Optional Spotify song discovery

Create a Spotify developer app and put its client ID and client secret in the ignored root `.env` file:

```dotenv
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
```

Restart the API after changing `.env`. The server obtains a client-credentials token; the secret and token are never sent to the browser. A Spotify Development Mode app currently requires its owner to have Spotify Premium and has quota limits. Without credentials, the rest of Karaoke Server still works and the Spotify row shows a configuration message. The row uses Spotify track/artist/album metadata and unmodified remote album artwork with links to Spotify. It does not connect guests' Spotify accounts, expose Spotify playback, or use Spotify's retired Recommendations endpoint. Selecting a song searches YouTube for karaoke versions and still requires the user to choose and preview one. See [Spotify's quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) and [design guidelines](https://developer.spotify.com/documentation/design) before using this beyond personal development.

## Run locally

```powershell
pnpm install
pnpm dev
```

Open <http://localhost:5173>. Vite forwards `/api` calls to the API at port 3001. Without `YOUTUBE_API_KEY`, the interface loads normally but online search returns a clear configuration message.

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Run with Docker

```powershell
docker compose up --build
```

Open <http://localhost:3000>. Compose mounts only `./data` for SQLite app state. It does not mount a music library. The app does not download, proxy, or cache audio/video files. The same Compose setup is intended for the Ubuntu server, but that deployment has not been tested yet.

## Workspace layout

```text
apps/web/         React search and player interface
apps/server/      Node API and SQLite persistence
packages/shared/  Shared API contracts
docs/             Product and implementation notes
data/             SQLite app state (ignored by Git)
```

See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for current scope and [docs/STREAMING_PREVIEW.md](docs/STREAMING_PREVIEW.md) for provider and playback limitations.

## Lyrics

Use lyrics shown in the chosen YouTube karaoke video or its built-in captions. The separate synced-lyrics experiment is paused because timings from a different recording did not reliably match karaoke uploads. Its source files remain in the repository for possible future work, but the player does not show that panel and the lyrics API endpoints are disabled; normal use makes no LRCLIB requests.
