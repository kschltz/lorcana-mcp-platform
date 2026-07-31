import { useEffect, useRef } from "react";
import type { GameEvent } from "../types";

/** Small inline SVG icon per event type. */
function EventIcon({ type }: { type: string }) {
  const common = { width: 13, height: 13, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (type) {
    case "turn-start":
      return (
        <svg {...common} className="ev-icon ev-turn">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "ink":
      return (
        <svg {...common} className="ev-icon ev-ink">
          <path d="M8 2 C8 2 3.5 7.5 3.5 10.5 a4.5 4.5 0 0 0 9 0 C12.5 7.5 8 2 8 2 Z" fill="currentColor" />
        </svg>
      );
    case "play":
      return (
        <svg {...common} className="ev-icon ev-play">
          <rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 6h6M5 9h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "quest":
      return (
        <svg {...common} className="ev-icon ev-quest">
          <path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13l.7-4L2.2 6.3l4-.6Z" fill="currentColor" />
        </svg>
      );
    case "challenge":
    case "damage":
      return (
        <svg {...common} className="ev-icon ev-fight">
          <path d="M3 13 13 3M3 3l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "banish":
      return (
        <svg {...common} className="ev-icon ev-banish">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "sing":
      return (
        <svg {...common} className="ev-icon ev-sing">
          <path d="M6 11.5V4l6-1.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="4.5" cy="11.5" r="1.8" fill="currentColor" />
          <circle cx="10.5" cy="10" r="1.8" fill="currentColor" />
        </svg>
      );
    case "draw":
      return (
        <svg {...common} className="ev-icon ev-draw">
          <rect x="2.5" y="4" width="8" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="5.5" y="2" width="8" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "move":
      return (
        <svg {...common} className="ev-icon ev-move">
          <path d="M3 8h9M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "game-over":
      return (
        <svg {...common} className="ev-icon ev-over">
          <path d="M3 13V3h9l-2 3 2 3H5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="ev-icon ev-default">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
        </svg>
      );
  }
}

/** Scrolling event log; newest at the bottom, auto-scrolls on new events. */
export function LogPanel({ log }: { log: GameEvent[] }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastSeq = log.length > 0 ? log[log.length - 1].seq : 0;

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastSeq, log.length]);

  return (
    <div className="log-panel">
      <div className="log-header">Match Log</div>
      <div className="log-body" ref={bodyRef}>
        {log.map((ev) => (
          <div
            key={`${ev.turn}-${ev.seq}`}
            className={`log-entry${ev.player ? ` log-${ev.player}` : ""}`}
          >
            <EventIcon type={ev.type} />
            <div className="log-entry-main">
              <span className="log-turn">T{ev.turn}</span>
              <span className="log-message">{ev.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
