import type { PlayerState } from "../types";
import { DiscardPile, FaceDownStack, HandRow, PlayCard } from "./CardView";
import { LoreTracker } from "./LoreTracker";

/**
 * One player's half of the board (spectate-only: every hand is face-down).
 * `side` controls tooltip direction ("up" for the bottom player, "down" for top).
 */
export function PlayerArea({
  player,
  turn,
  isActive,
  side,
  label,
}: {
  player: PlayerState;
  turn: number;
  isActive: boolean;
  side: "up" | "down";
  label: string;
}) {
  const characters = player.play.filter((c) => c.card?.type !== "Item" && c.card?.type !== "Location");
  const support = player.play.filter((c) => c.card?.type === "Item" || c.card?.type === "Location");

  return (
    <section className={`player-area${isActive ? " active" : ""}`}>
      <header className="player-area-header">
        <span className={`player-tag player-tag-${player.id}`}>{label}</span>
        {isActive && <span className="active-pip" title="Active player">●</span>}
        <HandRow count={player.hand.length} />
      </header>

      <div className="player-area-main">
        <div className="zone-column">
          <FaceDownStack count={player.deck.length} label="Deck" />
          <FaceDownStack count={player.inkwell.length} label="Inkwell" inked />
          <DiscardPile discard={player.discard} tooltipSide={side} />
        </div>

        <div className="play-rows">
          <div className="character-row">
            {characters.length === 0 && <div className="row-empty">No characters in play</div>}
            {characters.map((c) => (
              <PlayCard key={c.instanceId} inst={c} turn={turn} tooltipSide={side} />
            ))}
          </div>
          <div className="support-row">
            {support.map((c) => (
              <PlayCard key={c.instanceId} inst={c} turn={turn} tooltipSide={side} />
            ))}
          </div>
        </div>

        <LoreTracker lore={player.lore} />
      </div>
    </section>
  );
}
