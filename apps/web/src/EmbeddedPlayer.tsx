import { useEffect, useRef, useState } from "react";

type YouTubePlayer = { destroy(): void };
type YouTubeApi = { Player: new (element: HTMLElement, options: {
  events: { onReady(): void; onError(event: { data: number }): void; onStateChange(event: { data: number }): void };
}) => YouTubePlayer };
declare global { interface Window { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void } }

let apiPromise: Promise<YouTubeApi> | undefined;
function loadApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement("script");
    const previous = window.onYouTubeIframeAPIReady;
    const finish = () => { clearTimeout(timer); if (previous) window.onYouTubeIframeAPIReady = previous; else delete window.onYouTubeIframeAPIReady; };
    const timer = setTimeout(() => { finish(); script.remove(); reject(new Error("Player could not load")); }, 15000);
    window.onYouTubeIframeAPIReady = () => { finish(); previous?.(); if (window.YT) resolve(window.YT); else reject(new Error("Player unavailable")); };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { finish(); script.remove(); reject(new Error("Player could not load")); };
    document.head.append(script);
  }).catch(error => { apiPromise = undefined; throw error; });
  return apiPromise;
}

export function EmbeddedPlayer({ videoId, onStarted }: { videoId: string; onStarted?: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Loading player…");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let player: YouTubePlayer | undefined;
    let terminalError = false;
    let started = false;
    setFailed(false); setMessage("Loading player…");
    const readyTimer = setTimeout(() => {
      if (!disposed) { setFailed(true); setMessage("The player is taking too long to respond. Retry, or try this app in Chrome or Edge."); }
    }, 20000);
    loadApi().then(api => {
      if (disposed || !container.current) return;
      const frame = document.createElement("iframe");
      frame.title = "YouTube karaoke player";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.src = `https://www.youtube.com/embed/${videoId}?${new URLSearchParams({ enablejsapi: "1", origin: location.origin, playsinline: "1" })}`;
      container.current.replaceChildren(frame);
      player = new api.Player(frame, { events: {
        onReady() {
          clearTimeout(readyTimer);
          if (!disposed && !terminalError) {
            setFailed(false); setMessage("Ready — press play in the video.");
          }
        },
        onError(event) {
          clearTimeout(readyTimer); terminalError = true;
          if (disposed) return;
          setFailed(true);
          const errors: Record<number, string> = {
            2: "This video link is invalid. Choose another version below.",
            5: "This browser could not play the video. Retry or open this app in Chrome or Edge.",
            100: "This video has been removed or made private. Choose another version below.",
            101: "This version’s owner has disabled embedded playback. Choose another version below to stay in the app.",
            150: "This version’s owner has disabled embedded playback. Choose another version below to stay in the app.",
            153: "YouTube could not identify this app’s browser connection. Try the app in Chrome or Edge."
          };
          setMessage(errors[event.data] ?? `This version could not play (YouTube ${event.data}). Choose another version below.`);
        },
        onStateChange(event) {
          if (disposed || terminalError) return;
          const states: Record<number, string> = { 0: "Finished", 1: "Playing here", 2: "Paused", 3: "Buffering…", 5: "Ready — press play in the video." };
          if (states[event.data]) { clearTimeout(readyTimer); setFailed(false); setMessage(states[event.data]!); }
          if (event.data === 1 && !started) {
            started = true;
            onStarted?.();
          }
        }
      } });
    }).catch(() => {
      clearTimeout(readyTimer);
      if (!disposed) { setFailed(true); setMessage("Could not load YouTube. Check your connection and retry. If you are using an in-app browser, try Chrome or Edge."); }
    });
    const element = container.current;
    return () => { disposed = true; clearTimeout(readyTimer); player?.destroy(); element?.replaceChildren(); };
  }, [videoId, attempt]);
  return <><div className="video-frame" ref={container} /><div className="playback-status" role={failed ? "alert" : "status"}><p>{message}</p>{failed && <button onClick={() => setAttempt(value => value + 1)}>Retry player</button>}</div></>;
}
