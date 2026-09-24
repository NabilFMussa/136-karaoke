import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HistoryResponse, OnlineTrack, PlayedTrack, QueueEntry, QueueResponse } from "@karaoke/shared";
import { ChannelBadge } from "./ChannelBadge";
import { Player } from "./Player";
import { SpotifyDiscovery } from "./SpotifyDiscovery";
import "./streaming.css";
import "./design.css";

function playerUrl(track: OnlineTrack, query: string) {
  return `/player?${new URLSearchParams({ v: track.videoId, title: track.title, artist: track.artist, brand: track.brand, q: query })}`;
}

export function App() {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<OnlineTrack[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [searched, setSearched] = useState("");
  const [singerName, setSingerName] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState("");
  const [queueNotice, setQueueNotice] = useState("");
  const [queueBusy, setQueueBusy] = useState(false);
  const [recent, setRecent] = useState<PlayedTrack[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [searchView, setSearchView] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const queueInput = useRef<HTMLInputElement>(null);
  const queueDrawer = useRef<HTMLElement>(null);
  const activeSearch = useRef<AbortController | null>(null);

  async function refreshQueue() {
    try {
      const response = await fetch("/api/queue");
      if (!response.ok) throw new Error("Queue is unavailable.");
      const data = await response.json() as QueueResponse;
      setQueue(data.entries);
      setQueueError("");
    } catch {
      setQueueError("Could not load the singer queue. Please retry.");
    }
  }

  async function refreshHistory() {
    try {
      const response = await fetch("/api/history");
      if (!response.ok) throw new Error("Recently played is unavailable.");
      const data = await response.json() as HistoryResponse;
      setRecent(data.entries);
      setHistoryError("");
    } catch {
      setHistoryError("Could not load recently played songs.");
    }
  }

  useEffect(() => {
    if (location.pathname === "/player") return;
    void refreshQueue();
    void refreshHistory();
    const interval = window.setInterval(() => void refreshQueue(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!queueOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQueueOpen(false);
      if (event.key !== "Tab") return;
      const focusable = queueDrawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]');
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [queueOpen]);

  async function runSearch(nextQuery: string) {
    const searchTerm = nextQuery.trim();
    if (searchTerm.length < 2) return;
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    setSearchView(true);
    window.scrollTo({ top: 0 });
    const timeout = setTimeout(() => controller.abort(), 18000);
    setState("loading");
    setError("");
    setTracks([]);
    setSearched(searchTerm);
    try {
      const response = await fetch(`/api/catalogue/search?q=${encodeURIComponent(searchTerm)}`, { signal: controller.signal });
      const data = await response.json() as { tracks?: OnlineTrack[]; error?: string };
      if (!response.ok || !data.tracks) throw new Error(data.error || "Could not search the catalogue.");
      if (activeSearch.current !== controller) return;
      setTracks(data.tracks);
      setState("done");
    } catch (err) {
      if (activeSearch.current !== controller) return;
      setError(err instanceof Error ? err.message : "Search failed. Please retry.");
      setState("error");
    } finally {
      clearTimeout(timeout);
      if (activeSearch.current === controller) activeSearch.current = null;
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  function selectPick(title: string, artist: string) {
    const searchTerm = `${artist} ${title}`;
    setQuery(searchTerm);
    void runSearch(searchTerm);
  }

  function goHome() {
    activeSearch.current?.abort();
    activeSearch.current = null;
    setSearchView(false);
    setState("idle");
    window.scrollTo({ top: 0 });
  }

  async function addTrack(track: OnlineTrack) {
    if (!singerName.trim()) {
      setQueueError("Enter your name to join.");
      setQueueOpen(true);
      return;
    }
    setQueueBusy(true); setQueueError(""); setQueueNotice("");
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, singerName: singerName.trim() })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not add this song.");
      setQueueNotice(`${track.title} added for ${singerName.trim()}.`);
      await refreshQueue();
      setQueueOpen(true);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Could not add this song.");
    } finally {
      setQueueBusy(false);
    }
  }

  async function removeEntry(id: string) {
    setQueueBusy(true); setQueueError(""); setQueueNotice("");
    try {
      const response = await fetch(`/api/queue/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove this queue entry.");
      await refreshQueue();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Could not remove this queue entry.");
    } finally { setQueueBusy(false); }
  }

  async function moveEntry(index: number, offset: -1 | 1) {
    const reordered = [...queue];
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= reordered.length) return;
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
    setQueueBusy(true); setQueueError(""); setQueueNotice("");
    try {
      const response = await fetch("/api/queue/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map(entry => entry.id) })
      });
      const data = await response.json() as QueueResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not reorder the queue.");
      setQueue(data.entries);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Could not reorder the queue.");
      await refreshQueue();
    } finally { setQueueBusy(false); }
  }

  if (location.pathname === "/player") return <Player />;
  return <main className="stream-app">
    <header className="app-header"><button type="button" className="wordmark" onClick={goHome} aria-label="136 Karaoke home">136 Karaoke</button>
      <form className="header-search" onSubmit={search}><label htmlFor="song-search" className="sr-only">Search songs or artists</label><span aria-hidden="true" className="search-icon">⌕</span><input ref={searchInput} id="song-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="What do you want to sing?" minLength={2} maxLength={120} required /><button disabled={query.trim().length < 2} aria-label="Search songs">Search</button></form>
      <button type="button" className="header-queue" aria-expanded={queueOpen} aria-controls="queue-drawer" onClick={() => setQueueOpen(value => !value)}>Queue <span>{queue.length}</span></button></header>
    <div className="app-layout"><nav className="side-nav" aria-label="Main navigation"><button type="button" className={!searchView ? "active" : ""} onClick={goHome} aria-label="Home"><span aria-hidden="true">⌂</span><small>Home</small></button><button type="button" className={searchView ? "active" : ""} onClick={() => { setSearchView(true); searchInput.current?.focus(); }} aria-label="Search"><span aria-hidden="true">⌕</span><small>Search</small></button><button type="button" className={queueOpen ? "active" : ""} onClick={() => setQueueOpen(value => !value)} aria-label="Queue" aria-expanded={queueOpen} aria-controls="queue-drawer"><span aria-hidden="true">≡</span><small>Queue</small></button></nav><div className="app-content">
    {!searchView && <><section className="search-intro"><h1>Search</h1><button type="button" onClick={() => searchInput.current?.focus()}>Start <span aria-hidden="true">↗</span></button></section>

    <section className="recent-section" aria-labelledby="recent-heading">
      <div className="recent-heading"><h2 id="recent-heading">Recent</h2><button type="button" onClick={() => void refreshHistory()}>Refresh</button></div>
      {historyError && <p role="alert">{historyError}</p>}
      {!historyError && recent.length === 0 && <p>Play a song here and it will appear in this list.</p>}
      <div className="recent-list">{recent.map(item => <a className="recent-card" key={item.videoId} href={playerUrl(item, item.searchQuery ?? "")}>
        <img src={`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`} alt="" loading="lazy" /><span className="recent-play" aria-hidden="true">▶</span><strong>{item.title}</strong><span>{[item.artist, item.brand].filter(Boolean).join(" · ") || "YouTube karaoke"}</span><small>Played {new Date(item.playedAt).toLocaleString()}</small>
      </a>)}</div>
    </section>

    <SpotifyDiscovery onSelect={selectPick} />
    </>}

    {searchView && <section className="results-section" aria-label="Search results" aria-busy={state === "loading"}>
      <button type="button" className="back-button" onClick={goHome}>← Home</button>
      <h1>{state === "loading" ? "Searching…" : "Results"}</h1>
      {(state === "loading" || state === "done") && <div role="status" className="search-status">{state === "loading" && <><span className="search-spinner" aria-hidden="true" />“{searched}”<span className="search-progress" /></>}{state === "done" && `${tracks.length} for “${searched}”`}</div>}
      {state === "loading" && <div className="search-skeletons" aria-hidden="true"><span /><span /><span /><span /></div>}
      {state === "error" && <p role="alert">{error} <a href={`https://www.youtube.com/results?${new URLSearchParams({ search_query: `${searched} karaoke` })}`} target="_blank" rel="noreferrer">Search YouTube directly</a></p>}
      {state === "done" && !tracks.length && <p>No online versions found. Try another song title or artist.</p>}
      {state === "idle" && <p>Search for a song above.</p>}
      <div className="track-list">{tracks.map((track, index) => <article className={`track${track.highlight ? " track-highlighted" : ""}`} key={track.videoId}><span className="track-number">{String(index + 1).padStart(2, "0")}</span><a className="result-thumbnail" href={playerUrl(track, searched)} aria-label={`Preview ${track.title}`}><img src={`https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`} alt="" loading="lazy" /></a><div className="result-details"><h2>{track.title}</h2><p>{[track.artist, track.brand].filter(Boolean).join(" · ") || "YouTube karaoke"}</p><ChannelBadge track={track} /></div><div className="track-actions"><a className="preview-link" href={playerUrl(track, searched)}>Preview</a><button disabled={queueBusy} onClick={() => void addTrack(track)}>{queueBusy ? "Updating…" : "Add to queue"}</button></div></article>)}</div>
    </section>}
    </div></div>
    {queueOpen && <><button type="button" className="queue-backdrop" aria-label="Close queue" onClick={() => setQueueOpen(false)} /><aside ref={queueDrawer} id="queue-drawer" className="queue-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-heading">
      <div className="queue-heading"><h2 id="queue-heading">Queue <span>{queue.length}</span></h2><button type="button" className="queue-close" aria-label="Close queue" onClick={() => setQueueOpen(false)}>×</button></div>
      <label className="singer-name">Name<input ref={queueInput} value={singerName} onChange={event => { setSingerName(event.target.value); setQueueError(""); }} placeholder="Your name" maxLength={60} /></label>
      {queueError && <p role="alert" className="queue-message">{queueError}</p>}{queueNotice && <p role="status" className="queue-message">{queueNotice}</p>}
      {queue.length === 0 && <p className="queue-empty">No songs yet.</p>}
      <ol className="queue-list">{queue.map((entry, index) => <li className="queue-entry" key={entry.id}>
        <span className="queue-position">{String(index + 1).padStart(2, "0")}</span>
        <div className="queue-song"><strong>{entry.title}</strong><span>{[entry.artist, entry.brand].filter(Boolean).join(" · ") || "YouTube karaoke"}</span><span className="queue-singer">{entry.singerName}</span></div>
        <div className="queue-actions"><button type="button" aria-label={`Move ${entry.title} up`} disabled={queueBusy || index === 0} onClick={() => void moveEntry(index, -1)}>↑</button><button type="button" aria-label={`Move ${entry.title} down`} disabled={queueBusy || index === queue.length - 1} onClick={() => void moveEntry(index, 1)}>↓</button><button type="button" className="remove-entry" disabled={queueBusy} onClick={() => void removeEntry(entry.id)} aria-label={`Remove ${entry.title} for ${entry.singerName}`}>×</button></div>
      </li>)}</ol>
    </aside></>}
  </main>;
}
