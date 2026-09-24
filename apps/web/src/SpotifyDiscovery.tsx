import { useEffect, useState } from "react";
import type { SpotifySong, SpotifySuggestionsResponse } from "@karaoke/shared";

export function SpotifyDiscovery({ onSelect }: { onSelect: (title: string, artist: string) => void }) {
  const [songs, setSongs] = useState<SpotifySong[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/spotify/suggestions", { signal: controller.signal })
      .then(async response => {
        const data = await response.json() as SpotifySuggestionsResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "Spotify discovery is unavailable.");
        return data;
      })
      .then(data => { if (!controller.signal.aborted) { setSongs(data.songs); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Spotify discovery is unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  return <section className="spotify-section" aria-labelledby="spotify-heading" aria-busy={loading}>
    <div className="spotify-heading"><h2 id="spotify-heading">Discover</h2>
      <div className="spotify-heading-actions"><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Shuffle</button>
        <a href="https://open.spotify.com/" target="_blank" rel="noreferrer" aria-label="Open Spotify"><img src="https://developer-assets.spotifycdn.com/images/guidelines/design/full-logo-framed.svg" alt="Spotify" /></a></div>
    </div>
    {loading && <p role="status">Loading…</p>}
    {error && <p role="status">{error}</p>}
    <div className="spotify-list">{songs.map(song => <article className="spotify-card" key={song.id}>
      {song.coverUrl && <img className="spotify-cover" src={song.coverUrl} alt={`Album cover for ${song.album}`} loading="lazy" />}
      <div><span className="spotify-genre">{song.genre}</span><h3>{song.title}</h3><p>{song.artist}</p></div>
      <a href={song.spotifyUrl} target="_blank" rel="noreferrer">Open on Spotify</a>
      <button type="button" onClick={() => onSelect(song.title, song.artist)}>Find karaoke</button>
    </article>)}</div>
  </section>;
}
