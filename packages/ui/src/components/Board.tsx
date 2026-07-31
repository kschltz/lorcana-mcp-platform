import { useEffect, useState } from "react";
import { getState, subscribeStream } from "../api";
import type { GameState } from "../types";
import { LogPanel } from "./LogPanel";
import { PlayerArea } from "./PlayerArea";

const WIN_REASON_LABEL: Record<string, string> = {
  lore: "reached 20 lore",
  "deck-out": "opponent decked out",
  concede: "opponent conceded",
};

/** Board view (route #/match/:id): subscribes to the live stream. */
export function Board({ matchId }: { matchId: string }) {
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    setState(null);
    let cancelled = false;
    getState(matchId).then((s) => {
      if (!cancelled) setState(s);
    });
    const sub = subscribeStream(matchId, setState);
    return () => {
      cancelled = true;
      sub.close();
    };
  }, [matchId]);

  if (!state) {
    return (
      <div className="board-loading">
        <p>Loading match {matchId}…</p>
      </div>
    );
  }

  const { p1, p2 } = state.players;
  const over = state.phase === "game-over" || !!state.winner;

  return (
    <div className="board">
      <div className="board-areas">
        <PlayerArea
          player={p2}
          turn={state.turn}
          isActive={state.activePlayer === "p2" && !over}
          side="down"
          label="Player 2"
        />
        <div className="mid-divider" />
        <PlayerArea
          player={p1}
          turn={state.turn}
          isActive={state.activePlayer === "p1" && !over}
          side="up"
          label="Player 1"
        />
      </div>

      <aside className="board-side">
        <div className="status-card">
          <div className="status-turn">Turn {state.turn}</div>
          <div className="status-phase">
            Phase <strong>{state.phase}</strong>
          </div>
          {!over && (
            <div className="status-active">
              <span className={`active-dot active-dot-${state.activePlayer}`} />
              {state.activePlayer === "p1" ? "Player 1" : "Player 2"} to act
            </div>
          )}
          {over && state.winner && (
            <div className="winner-banner">
              <div className="winner-title">
                {state.winner === "p1" ? "Player 1" : "Player 2"} wins
              </div>
              <div className="winner-reason">
                {WIN_REASON_LABEL[state.winReason ?? ""] ?? "game over"}
              </div>
            </div>
          )}
          {over && !state.winner && <div className="winner-banner">Game over</div>}
        </div>
        <LogPanel log={state.log} />
      </aside>
    </div>
  );
}
