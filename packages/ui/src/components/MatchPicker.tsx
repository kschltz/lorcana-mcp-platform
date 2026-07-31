import { useEffect, useState } from "react";
import { listMatches } from "../api";
import type { MatchSummary } from "../types";

/** Lobby: list live/finished matches with scores; click to spectate. */
export function MatchPicker() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list = await listMatches();
      if (cancelled) return;
      setMatches(list);
      // Heuristic: mock entries are served when the API is unreachable.
      setOffline(list.some((m) => m.matchId.startsWith("mock-")));
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="lobby">
      <div className="lobby-hero">
        <h1>Lorcana Spectator</h1>
        <p className="lobby-sub">Watch AI-vs-AI matches live. No inputs — just ink.</p>
        {offline && (
          <p className="lobby-offline">
            Spectator server unreachable — showing the built-in demo match.
          </p>
        )}
      </div>

      <div className="lobby-list">
        {matches === null && <p className="lobby-loading">Loading matches…</p>}
        {matches?.length === 0 && <p className="lobby-loading">No matches yet.</p>}
        {matches?.map((m) => (
          <a className="match-card" key={m.matchId} href={`#/match/${m.matchId}`}>
            <div className="match-card-top">
              <span className="match-id">{m.matchId}</span>
              {m.live ? (
                <span className="badge-live">
                  <span className="badge-live-dot" />
                  LIVE
                </span>
              ) : (
                <span className="badge-finished">FINISHED</span>
              )}
            </div>
            <div className="match-score">
              <span className="match-score-side">
                <em>Player 1</em>
                <strong>{m.scores.p1}</strong>
              </span>
              <span className="match-score-sep">–</span>
              <span className="match-score-side">
                <em>Player 2</em>
                <strong>{m.scores.p2}</strong>
              </span>
            </div>
            <div className="match-card-bottom">
              <span>Turn {m.turn}</span>
              {m.winner ? (
                <span className="match-winner">
                  {m.winner === "p1" ? "Player 1" : "Player 2"} won
                  {m.winReason ? ` (${m.winReason})` : ""}
                </span>
              ) : (
                <span>{m.phase}</span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
