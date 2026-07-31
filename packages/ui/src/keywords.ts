import type { CardInstance, Keyword } from "./types";

export interface KeywordChip {
  label: string;
  granted: boolean;
}

const KEYWORD_PATTERNS: { re: RegExp; keyword: Keyword }[] = [
  { re: /(?:^|\n)[A-Za-z' ]*Shift\s+\d+/i, keyword: "Shift" },
  { re: /(?:^|\n)\s*Bodyguard\b/, keyword: "Bodyguard" },
  { re: /(?:^|\n)\s*Rush\b/, keyword: "Rush" },
  { re: /(?:^|\n)\s*Evasive\b/, keyword: "Evasive" },
  { re: /(?:^|\n)\s*Ward\b/, keyword: "Ward" },
  { re: /(?:^|\n)\s*Support\b/, keyword: "Support" },
  { re: /(?:^|\n)\s*Reckless\b/, keyword: "Reckless" },
  { re: /(?:^|\n)\s*Alert\b/, keyword: "Alert" },
  { re: /(?:^|\n)\s*Vanish\b/, keyword: "Vanish" },
  { re: /(?:^|\n)\s*Boost\s+\d+/i, keyword: "Boost" },
];

/** Derive display chips from bodyText keyword headers + granted modifier keywords. */
export function keywordChips(inst: CardInstance): KeywordChip[] {
  const chips: KeywordChip[] = [];
  const seen = new Set<string>();
  const text = inst.card?.bodyText ?? "";

  const push = (label: string, granted: boolean) => {
    const key = `${label}:${granted}`;
    if (seen.has(key)) return;
    seen.add(key);
    chips.push({ label, granted });
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    for (const { re, keyword } of KEYWORD_PATTERNS) {
      if (re.test(`\n${trimmed}`)) {
        // Use the matched header text (e.g. "Puppy Shift 3", "Resist +1", "Singer 5").
        const header = trimmed.split(/[(:]/)[0].trim();
        push(header.length > 0 && header.length <= 22 ? header : keyword, false);
      }
    }
    const resist = trimmed.match(/^Resist\s*\+?\s*(\d+)/);
    if (resist) push(`Resist +${resist[1]}`, false);
    const challenger = trimmed.match(/^Challenger\s*\+?\s*(\d+)/);
    if (challenger) push(`Challenger +${challenger[1]}`, false);
    const singer = trimmed.match(/^Singer\s+(\d+)/);
    if (singer) push(`Singer ${singer[1]}`, false);
  }

  for (const mod of inst.modifiers) {
    for (const kw of mod.grantKeywords ?? []) push(kw, true);
  }
  return chips;
}

/** Sum of stat modifiers for display alongside printed stats. */
export function statModifiers(inst: CardInstance): {
  strength: number;
  willpower: number;
  lore: number;
} {
  const total = { strength: 0, willpower: 0, lore: 0 };
  for (const mod of inst.modifiers) {
    total.strength += mod.stat?.strength ?? 0;
    total.willpower += mod.stat?.willpower ?? 0;
    total.lore += mod.stat?.lore ?? 0;
  }
  return total;
}
