import { useState } from "react";
import type { CardDefinition, CardInstance } from "../types";
import { keywordChips, statModifiers } from "../keywords";

/** Elegant inline SVG card back — ink-drop over a diamond lattice. */
export function CardBack({ width = 64 }: { width?: number }) {
  const height = Math.round(width * 1.4);
  return (
    <svg
      className="card-back-svg"
      width={width}
      height={height}
      viewBox="0 0 70 98"
      role="img"
      aria-label="Card back"
    >
      <defs>
        <pattern id="ink-lattice" width="14" height="14" patternUnits="userSpaceOnUse">
          <path
            d="M7 0 L14 7 L7 14 L0 7 Z"
            fill="none"
            stroke="#3a3a4a"
            strokeWidth="0.8"
          />
          <circle cx="7" cy="7" r="1" fill="#3a3a4a" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="68" height="96" rx="7" fill="#1d1d27" stroke="#4a4a5e" strokeWidth="1.5" />
      <rect x="5" y="5" width="60" height="88" rx="5" fill="url(#ink-lattice)" stroke="#33333f" strokeWidth="1" />
      <path
        d="M35 34 C35 34 25 48 25 56 a10 10 0 0 0 20 0 C45 48 35 34 35 34 Z"
        fill="none"
        stroke="#c8b98a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="35" cy="56" r="3.2" fill="#c8b98a" opacity="0.85" />
    </svg>
  );
}

/** Card art with graceful fallback to a styled frame when the image fails. */
export function CardImage({
  card,
  className,
}: {
  card: CardDefinition | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!card || failed) {
    return (
      <div className={`card-image-fallback ${className ?? ""}`}>
        <span className="card-image-fallback-name">{card?.name ?? "Unknown"}</span>
        {card?.subtitle && <span className="card-image-fallback-subtitle">{card.subtitle}</span>}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={card.imageUrl}
      alt={card.fullName}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** Large hover tooltip: full art + rules text. */
export function CardTooltip({
  inst,
  side,
}: {
  inst: CardInstance;
  side: "up" | "down";
}) {
  const card = inst.card;
  if (!card) return null;
  const chips = keywordChips(inst);
  return (
    <div className={`card-tooltip card-tooltip-${side}`} role="tooltip">
      <div className="card-tooltip-art">
        <CardImage card={card} />
      </div>
      <div className="card-tooltip-body">
        <div className="card-tooltip-name">{card.fullName}</div>
        <div className="card-tooltip-meta">
          {card.type} · Cost {card.cost}
          {card.type === "Character" &&
            ` · ${card.strength}/${card.willpower} · ${card.lore} lore`}
          {card.type === "Location" && ` · ${card.willpower} willpower · move ${card.moveCost ?? 1}`}
          {card.inkable ? " · Inkable" : ""}
        </div>
        {chips.length > 0 && (
          <div className="chip-row">
            {chips.map((c) => (
              <span key={c.label} className={`chip${c.granted ? " chip-granted" : ""}`}>
                {c.label}
              </span>
            ))}
          </div>
        )}
        <div className="card-tooltip-text">
          {card.bodyText.split("\n").map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="card-tooltip-footer">
          {card.setId} · {card.rarity} · #{card.cardNum}
        </div>
      </div>
    </div>
  );
}

/** Wet-ink droplet badge (inline SVG, shown when enteredTurn === current turn). */
export function WetBadge() {
  return (
    <span className="badge badge-wet" title="Wet ink — entered play this turn">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M6 1 C6 1 2.5 5.2 2.5 7.5 a3.5 3.5 0 0 0 7 0 C9.5 5.2 6 1 6 1 Z"
          fill="#7fb4c9"
          stroke="#bfe0ee"
          strokeWidth="0.8"
        />
      </svg>
    </span>
  );
}

/** A single card in play: art, rotation when exerted, badges + chips. */
export function PlayCard({
  inst,
  turn,
  tooltipSide,
}: {
  inst: CardInstance;
  turn: number;
  tooltipSide: "up" | "down";
}) {
  const card = inst.card;
  const isCharacter = card?.type === "Character";
  const wet = inst.enteredTurn === turn;
  const chips = keywordChips(inst);
  const stats = statModifiers(inst);
  const stackSize = 1 + (inst.under?.length ?? 0);

  return (
    <div className={`play-card${inst.exerted ? " exerted" : ""}`}>
      <div className="play-card-inner">
        <CardImage card={card} className="play-card-art" />
        {isCharacter && (
          <div className="play-card-stats">
            <span className="stat stat-str" title="Strength">
              {card!.strength! + stats.strength}
              {stats.strength !== 0 && <em>{stats.strength > 0 ? "+" : ""}{stats.strength}</em>}
            </span>
            <span className="stat stat-wil" title="Willpower">
              {card!.willpower! + stats.willpower}
            </span>
            <span className="stat stat-lore" title="Lore">
              {(card!.lore ?? 0) + stats.lore}
            </span>
          </div>
        )}
        {inst.damage > 0 && (
          <span className="badge badge-damage" title={`${inst.damage} damage`}>
            {inst.damage}
          </span>
        )}
        {wet && <WetBadge />}
        {stackSize > 1 && (
          <span className="badge badge-shift" title={`Shift stack of ${stackSize} cards`}>
            ⇧{stackSize}
          </span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="chip-row play-card-chips">
          {chips.slice(0, 3).map((c) => (
            <span key={c.label} className={`chip${c.granted ? " chip-granted" : ""}`}>
              {c.label}
            </span>
          ))}
          {chips.length > 3 && <span className="chip chip-more">+{chips.length - 3}</span>}
        </div>
      )}
      <CardTooltip inst={inst} side={tooltipSide} />
    </div>
  );
}

/** Face-down stack (deck / inkwell) with a count badge. */
export function FaceDownStack({
  count,
  label,
  inked,
}: {
  count: number;
  label: string;
  inked?: boolean;
}) {
  return (
    <div className="fd-stack" title={`${label}: ${count}`}>
      <div className={`fd-stack-visual${inked ? " fd-stack-inkwell" : ""}`}>
        <CardBack width={56} />
        {count > 1 && <div className="fd-stack-layer" />}
      </div>
      <span className="fd-stack-count">{count}</span>
      <span className="fd-stack-label">{label}</span>
    </div>
  );
}

/** Discard pile showing the top card's art. */
export function DiscardPile({
  discard,
  tooltipSide,
}: {
  discard: CardInstance[];
  tooltipSide: "up" | "down";
}) {
  const top = discard[discard.length - 1];
  if (!top) {
    return (
      <div className="discard-pile" title={`Discard: ${discard.length}`}>
        <div className="discard-empty" />
        <span className="fd-stack-label">Discard</span>
      </div>
    );
  }
  return (
    <div className="discard-pile" title={`Discard: ${discard.length}`}>
      <div className="play-card">
        <div className="play-card-inner">
          <CardImage card={top.card} className="play-card-art discard-top" />
          <span className="fd-stack-count">{discard.length}</span>
        </div>
        <CardTooltip inst={top} side={tooltipSide} />
      </div>
      <span className="fd-stack-label">Discard</span>
    </div>
  );
}

/** Row of face-down hand cards (spectate-only: both players shown as backs). */
export function HandRow({ count }: { count: number }) {
  return (
    <div className="hand-row" title={`Hand: ${count}`}>
      {Array.from({ length: Math.min(count, 10) }, (_, i) => (
        <div className="hand-card" key={i} style={{ zIndex: i }}>
          <CardBack width={44} />
        </div>
      ))}
      <span className="hand-count">×{count}</span>
    </div>
  );
}
