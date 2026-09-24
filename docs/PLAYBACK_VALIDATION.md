# Streaming playback validation

Actual embedded playback was confirmed in Chrome on 2026-09-22, superseding the unverified-playback status in STREAMING_PREVIEW.md.

Test: search the live catalogue for Never Gonna Give You Up, select Rick Astley / Zoom, YouTube ID `9iQH7g_zKl8`.

The official YouTube player loaded inside the local `/player` page. Clicking Play produced a Pause control and an advancing timer; the video was paused at 10 seconds. No server-side media download was used.

The identical page in the Codex in-app browser remained at an unloaded iframe during the comparison. Earlier ABBA examples in that browser reported owner-disabled embedding or unavailable media. These observations do not establish that every failure is caused by the browser, nor guarantee playback for other songs, devices, networks or sessions.

Use Chrome for the current playback preview. Per-video availability and embedding restrictions still apply. Player errors and alternate versions are now handled on the page; shared queue/TV controls and Docker runtime validation remain outstanding.

## Follow-up validation (2026-09-23)

The player now keeps its alternate-version list while switching versions instead of searching again and clearing the choices. The original selection remains available so the user can switch back. In Chrome, switching from Stingray Karaoke to Zoom Karaoke for TLC's No Scrubs kept one embedded player, retained a Stingray choice, and the Zoom video entered the playing state. Provider availability can still change independently of the app.

`pnpm typecheck`, `pnpm test` (8 tests), and `pnpm build` passed. Docker and cross-device playback remain to be validated.
