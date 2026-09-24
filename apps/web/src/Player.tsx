import { useEffect, useState } from "react";
import type { OnlineTrack } from "@karaoke/shared";
import { ChannelBadge } from "./ChannelBadge";
import { EmbeddedPlayer } from "./EmbeddedPlayer";

function fromUrl(): OnlineTrack {
  const params = new URLSearchParams(location.search);
  const searchQuery = params.get("q");
  return { videoId: params.get("v") ?? "", title: params.get("title") || "Online karaoke", artist: params.get("artist") ?? "", brand: params.get("brand") ?? "", source: "youtube", ...(searchQuery ? { searchQuery } : {}) };
}

export function Player() {
  const [track, setTrack] = useState(fromUrl);
  const [versions, setVersions] = useState<OnlineTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [retry, setRetry] = useState(0);
  const valid = /^[\w-]{11}$/.test(track.videoId);
  const searchQuery = track.searchQuery || `${track.title} ${track.artist} karaoke`;
  useEffect(() => {
    const listener = () => setTrack(fromUrl());
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    if (!valid || track.title === "Online karaoke") return;
    const controller = new AbortController();
    setLoading(true); setError(""); setVersions([]);
    fetch(`/api/catalogue/search?q=${encodeURIComponent(searchQuery.slice(0, 120))}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Other versions could not be loaded. Please retry."); return await response.json() as { tracks: OnlineTrack[] }; })
      .then(data => {
        if (controller.signal.aborted) return;
        const tracks = data.tracks.filter(item => item.videoId !== track.videoId);
        setVersions([...tracks, track]);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load versions."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchQuery, valid, retry]);
  function choose(item: OnlineTrack) {
    const selected = { ...item, searchQuery };
    history.pushState(null, "", `/player?${new URLSearchParams({ v: selected.videoId, title: selected.title, artist: selected.artist, brand: selected.brand, q: selected.searchQuery ?? "" })}`);
    setTrack(selected);
    setHistoryError("");
  }
  async function recordStarted(item: OnlineTrack) {
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: item })
      });
      if (!response.ok) throw new Error("Could not save this song to recently played.");
      setHistoryError("");
    } catch {
      setHistoryError("Could not save this song to recently played.");
    }
  }
  return <main className="stream-app player-page">
    <header><a className="wordmark" href="/">136 Karaoke</a><a href="/">← Back to catalogue</a></header>
    <div className="player-layout"><div className="player-primary"><h1>{valid ? track.title : "Player"}</h1><p className="player-byline">{valid ? [track.artist, track.brand].filter(Boolean).join(" · ") : "Search the catalogue to choose a song."}</p>
    {valid && <><EmbeddedPlayer videoId={track.videoId} onStarted={() => void recordStarted(track)} />
      {historyError && <p role="alert">{historyError}</p>}
      </>}</div>
      {valid && <section className="player-versions" aria-label="Karaoke versions"><h2>Versions</h2>
        {loading && <p role="status">Finding other versions…</p>}
        {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry versions</button></p>}
        {!loading && !error && versions.length === 0 && <p>No matching alternatives found. <a href="/">Search for another song</a>.</p>}
        <div className="track-list">{versions.filter(item => item.videoId !== track.videoId).map(item => <article className={`track${item.highlight ? " track-highlighted" : ""}`} key={item.videoId}><div><h3>{item.brand || "Karaoke version"}</h3><p>{[item.artist, item.title].filter(Boolean).join(" · ")}</p><ChannelBadge track={item} /></div><button onClick={() => choose(item)}>Use version</button></article>)}</div>
      </section>}</div>
  </main>;
}
