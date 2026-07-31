import { LORE_TO_WIN } from "../types";

/** Prominent lore tracker: big "X / 20" plus an amber progress bar. */
export function LoreTracker({ lore }: { lore: number }) {
  const pct = Math.min(100, (lore / LORE_TO_WIN) * 100);
  return (
    <div className="lore-tracker" title={`Lore: ${lore} / ${LORE_TO_WIN}`}>
      <div className="lore-number">
        <span className="lore-value">{lore}</span>
        <span className="lore-goal">/ {LORE_TO_WIN}</span>
      </div>
      <div className="lore-bar">
        <div className="lore-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="lore-caption">LORE</div>
    </div>
  );
}
