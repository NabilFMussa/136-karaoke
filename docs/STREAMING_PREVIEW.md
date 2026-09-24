# Milestone 2: online streaming preview

This preview searches YouTube through the official YouTube Data API v3 and plays provider-hosted video inside `/player`. The server does not download, proxy, or store song audio/video. SQLite stores app state such as the singer queue.

## Implementation

- `GET /api/catalogue/search?q=...` makes one broad YouTube Data API `search.list` call for up to 50 embeddable videos. It then looks up the returned channels' subscriber statistics in one batched `channels.list` call. Results retain their original YouTube titles and search order; Sing King and CC Karaoke receive a trusted-channel badge, and other channels with at least 250,000 visible subscribers receive a popular-channel badge. Other results remain selectable.
- Configure `YOUTUBE_API_KEY` in the root `.env` file. The key is sent only from the server to Google; it must not be included in web assets or committed. Enable YouTube Data API v3 in Google Cloud and restrict the key appropriately.
- The adapter uses a five-minute, 50-query in-memory search cache, deduplicated requests, a concurrency bound, and a 12-second search timeout. Channel subscriber statistics are cached for 24 hours; if that optional lookup fails, search results still appear without popularity counts. Each uncached search uses one YouTube `search.list` call, so the default 100-call daily search allocation supports about 100 distinct uncached searches, plus the separate channel metadata lookup. It reports missing/invalid configuration and quota exhaustion explicitly.
- Video links are normalized to validated YouTube IDs; arbitrary URLs are not fetched or embedded.
- Playback uses the YouTube IFrame Player API. Users press play in the embedded video; there is no autoplay assumption.
- The player shows provider error states and offers matching alternate versions on the same page.

## Limits

Internet access and a YouTube Data API key are required for search. A popular or trusted channel is only a discovery cue, not a guarantee that an individual upload is a playable karaoke track. YouTube's first result page may omit a relevant version even when it exists. Subscriber counts are rounded by YouTube and may be hidden. Google's `videoEmbeddable=true` filter means the uploader has enabled embedding; it cannot guarantee playback. YouTube owner-disabled embedding, Content ID claims, removed videos, regional or age restrictions, ads, and browser policies may still affect playback. A provider-blocked video cannot be forced to play in the app; users can try another available version. Search is quota-limited; repeated queries are cached for five minutes. No local-media fallback is planned.

## Validation on Windows (2026-09-22)

- Previous Karaoke Nerds browser-search results for ABBA Waterloo returned 20 versions. That HTML-scraping integration has been replaced; the YouTube API path requires configuration and live search validation.
- The Karaoke Version video for Radiohead's Creep returned an owner-disabled embed error; the player displayed the restriction and offered alternatives. Selecting Sunfly switched the video within the same page. In Chrome, the YouTube player reported playback and its elapsed time reached 0:16 of a 4:10 video.
- Docker has not been built or run on this machine.

## References

- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
