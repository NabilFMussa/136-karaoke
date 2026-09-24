import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LyricsDocument, LyricsMatch, LyricsResponse, LyricsSearchResponse, OnlineTrack } from "@karaoke/shared";

function suggestedTitle(track: OnlineTrack): string {
  let title = track.title.trim();
  if (track.brand) {
    const escapedBrand = track.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`(?:\\s*[-–•|:]?\\s*)${escapedBrand}$`, "i"), "").trim();
  }
  title = title
    .replace(/\([^)]*(?:karaoke|instrumental|lyrics)[^)]*\)/gi, "")
    .replace(/\b(?:karaoke version|karaoke|lyrics on screen)\b/gi, "")
    .trim();
  if (track.artist) {
    const escaped = track.artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`^${escaped}(?:\\s*[-–•|:]\\s*|\\s+)`, "i"), "");
  } else {
    const bullet = title.match(/^.+?\s*•\s*(.+)$/);
    if (bullet) title = bullet[1]!;
  }
  return title.replace(/[-–•|:]\s*$/, "").trim();
}

function suggestedArtist(track: OnlineTrack): string {
  if (track.artist) return track.artist;
  const bullet = track.title.match(/^(.+?)\s*•\s*(.+)$/);
  return bullet?.[1]?.trim() ?? "";
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function exactMatches(matches: LyricsMatch[], title: string, artist: string): LyricsMatch[] {
  if (artist) return matches.filter(match => normalized(match.title) === normalized(title) && normalized(match.artist) === normalized(artist));
  const parts = title.split(/\s+[-–—]\s+/).map(normalized);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return [];
  return matches.filter(match =>
    (normalized(match.title) === parts[0] && normalized(match.artist) === parts[1]) ||
    (normalized(match.title) === parts[1] && normalized(match.artist) === parts[0]));
}

function errorMessage(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}

function durationLabel(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function SyncedLyrics({ track, currentTime, videoDuration }: { track: OnlineTrack; currentTime: number; videoDuration: number }) {
  const [title, setTitle] = useState(() => suggestedTitle(track));
  const [artist, setArtist] = useState(() => suggestedArtist(track));
  const [matches, setMatches] = useState<LyricsMatch[]>([]);
  const [lyrics, setLyrics] = useState<LyricsDocument | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "loading" | "done">("idle");
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedLine, setSelectedLine] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [pendingAuto, setPendingAuto] = useState<{ title: string; artist: string } | null>(null);
  const [timingUncertain, setTimingUncertain] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    // Delay until after StrictMode's development-only effect replay, so one song makes one lookup.
    const timer = window.setTimeout(() => {
      const suggestedSong = suggestedTitle(track);
      const suggestedSinger = suggestedArtist(track);
      if (suggestedSong) void searchFor(suggestedSong, suggestedSinger, true);
    }, 0);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!pendingAuto) return;
    if (videoDuration > 0) {
      setPendingAuto(null);
      const candidates = exactMatches(matches, pendingAuto.title, pendingAuto.artist);
      const closest = candidates.sort((a, b) => Math.abs(a.durationSeconds - videoDuration) - Math.abs(b.durationSeconds - videoDuration))[0];
      if (closest && Math.abs(closest.durationSeconds - videoDuration) <= 5) void choose(closest);
      else { setTimingUncertain(true); setShowSearch(true); }
      return;
    }
    const timer = window.setTimeout(() => { setPendingAuto(null); setShowSearch(true); }, 6000);
    return () => clearTimeout(timer);
  }, [pendingAuto, videoDuration, matches]);

  async function searchFor(songTitle: string, songArtist: string, automatic: boolean) {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setPendingAuto(null); setTimingUncertain(false);
    setStatus("searching"); setError(""); setMatches([]); setLyrics(null); setSearched(true);
    try {
      const params = new URLSearchParams({ title: songTitle.trim(), artist: songArtist.trim() });
      const response = await fetch(`/api/lyrics/search?${params}`, { signal: next.signal });
      const data = await response.json() as LyricsSearchResponse & { error?: string };
      if (!response.ok) throw new Error(errorMessage(data, "Could not search for lyrics."));
      if (next.signal.aborted) return;
      setMatches(data.matches);
      setStatus("done");
      if (automatic && exactMatches(data.matches, songTitle, songArtist).length) setPendingAuto({ title: songTitle, artist: songArtist });
      else setShowSearch(true);
    } catch (cause) {
      if (next.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not search for lyrics.");
      setStatus("idle"); setShowSearch(true);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) void searchFor(title, artist, false);
  }

  async function choose(match: LyricsMatch) {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setPendingAuto(null); setTimingUncertain(false);
    setStatus("loading"); setError("");
    try {
      const response = await fetch(`/api/lyrics/${match.id}`, { signal: next.signal });
      const data = await response.json() as LyricsResponse & { error?: string };
      if (!response.ok) throw new Error(errorMessage(data, "Could not load timed lyrics."));
      if (next.signal.aborted) return;
      setLyrics(data.lyrics);
      setOffset(0);
      setSelectedLine(0);
      setShowSearch(false);
      setStatus("done");
    } catch (cause) {
      if (next.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not load timed lyrics.");
      setStatus("done"); setShowSearch(true);
    }
  }

  const adjustedTime = currentTime + offset;
  let activeIndex = -1;
  if (lyrics) {
    for (let index = 0; index < lyrics.lines.length; index++) {
      if (lyrics.lines[index]!.timeSeconds <= adjustedTime) activeIndex = index;
      else break;
    }
  }
  const displayIndex = Math.max(0, activeIndex);
  const currentLine = lyrics?.lines[displayIndex];
  const previousLine = displayIndex > 0 ? lyrics?.lines[displayIndex - 1] : undefined;
  const nextLine = lyrics?.lines[displayIndex + 1];
  function syncSelectedLine() {
    const line = lyrics?.lines[selectedLine];
    if (line) setOffset(Math.max(-180, Math.min(180, Math.round((line.timeSeconds - currentTime) * 2) / 2)));
  }

  return <section className="lyrics-section" aria-labelledby="lyrics-heading">
    <div className="lyrics-heading"><div><p className="accent">SING ALONG</p><h2 id="lyrics-heading">Synced lyrics</h2></div><button type="button" onClick={() => setHidden(value => !value)}>{hidden ? "Show lyrics" : "Hide lyrics"}</button></div>
    {!hidden && <>
      <div className="karaoke-lyrics" aria-label="Karaoke lyrics" aria-live="off">
        {lyrics && currentLine ? <>
          <p className="karaoke-line karaoke-line-side" aria-hidden="true">{previousLine?.text ?? "\u00a0"}</p>
          <p className="karaoke-line karaoke-line-current" aria-current="true">{currentLine.text}</p>
          <p className="karaoke-line karaoke-line-side" aria-hidden="true">{nextLine?.text ?? "\u00a0"}</p>
        </> : <p className="karaoke-placeholder">{status === "searching" ? "Finding synced lyrics…" : pendingAuto ? "Checking lyric timing against this video…" : status === "loading" ? "Loading synced lyrics…" : timingUncertain ? "No closely timed match for this video. Choose lyrics below and sync a line, or use the video's own captions." : "Find a lyrics match to sing along here."}</p>}
      </div>
      {lyrics && <>
        <div className="lyrics-controls"><span>{lyrics.title} · {lyrics.artist}</span><label>Timing offset <input type="range" min="-180" max="180" step="0.5" value={offset} onChange={event => setOffset(Number(event.target.value))} /> <output>{offset > 0 ? "+" : ""}{offset.toFixed(1)}s</output></label><button type="button" className="lyrics-change" onClick={() => setShowSearch(value => !value)}>{showSearch ? "Close search" : "Change lyrics"}</button></div>
        <details className="lyrics-sync"><summary>Lyrics out of sync?</summary><p>Pause when a line appears in the video, choose that same line below, then match it to the current video time.</p><div><label>Line to match <select value={selectedLine} onChange={event => setSelectedLine(Number(event.target.value))}>{lyrics.lines.map((line, index) => <option key={`${line.timeSeconds}-${index}`} value={index}>{line.text}</option>)}</select></label><button type="button" onClick={syncSelectedLine}>Sync this line to video</button></div></details>
      </>}
      {(!lyrics || showSearch) && <div className="lyrics-picker">
        <p>{lyrics ? "Choose another synced recording if these words or timings do not fit." : "Check the song and artist, then choose a synced recording. Karaoke versions may have different intros."}</p>
        <form className="lyrics-search" onSubmit={search}>
          <label>Song title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required /></label>
          <label>Artist<input value={artist} onChange={event => setArtist(event.target.value)} maxLength={100} /></label>
          <button disabled={status === "searching" || status === "loading" || !title.trim()}>{status === "searching" ? "Searching…" : "Find lyrics"}</button>
        </form>
        {error && <p role="alert">{error}</p>}
        {searched && status === "done" && !matches.length && !lyrics && <p>No timed lyrics found. Try a shorter title or another artist.</p>}
        {matches.length > 0 && !pendingAuto && <div className="lyrics-matches"><p>Select a recording:</p>{matches.map(match => <button type="button" key={match.id} onClick={() => void choose(match)}>{match.title} · {match.artist}{match.durationSeconds ? ` · ${durationLabel(match.durationSeconds)}` : ""}</button>)}</div>}
      </div>}
      {lyrics && <p className="muted">Lyrics from <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>. Timing may differ from this karaoke upload; use the sync control or choose another recording. YouTube captions remain available in the video player.</p>}
    </>}
  </section>;
}
