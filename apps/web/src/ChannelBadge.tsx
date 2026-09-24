import type { OnlineTrack } from "@karaoke/shared";

export function ChannelBadge({ track }: { track: OnlineTrack }) {
  if (!track.highlight) return null;
  const subscribers = track.subscriberCount === undefined ? "" : ` · ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(track.subscriberCount)} subscribers`;
  return <span className={`channel-badge channel-badge-${track.highlight}`}>{track.highlight === "trusted" ? "Trusted channel" : "Popular channel"}{subscribers}</span>;
}
