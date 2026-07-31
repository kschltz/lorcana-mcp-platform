/**
 * normalize.ts — read data/lorcana_bulk.raw.json (lorcana-api.com PascalCase bulk dump)
 * and write dist-data/cards.json as CardDefinition[] per SPEC §3.1.
 *
 * Rules (SPEC §5):
 *  - keep only Lorcana-gamemode cards (skip Illumineer's Quest / other gamemodes);
 *    cards whose Gamemode field is absent or empty are regular Lorcana cards and kept.
 *  - split dual-ink `Color` on "," → colors array.
 *  - split "Name - Subtitle" on the first " - " (verified: no bulk name contains
 *    more than one " - ").
 *  - `{s}{w}{l}{d}{i}{e}` symbols stay raw inside bodyText.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardDefinition, CardType, InkColor } from "./dsl-types.js";

export const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RAW_PATH = join(PKG_DIR, "..", "..", "data", "lorcana_bulk.raw.json");
export const DIST_DATA_DIR = join(PKG_DIR, "dist-data");

const INK_COLORS: readonly string[] = ["Amber", "Amethyst", "Emerald", "Ruby", "Sapphire", "Steel"];

export interface RawBulkCard {
  Unique_ID: string;
  Name: string;
  Type: string; // "Character" | "Action" | "Item" | "Location" | "Action - Song"
  Color: string; // "Amber" | "Amber, Steel" (dual-ink)
  Cost: number;
  Inkable: boolean;
  Classifications?: string; // csv
  Body_Text?: string;
  Strength?: number;
  Willpower?: number;
  Lore?: number;
  Move_Cost?: number;
  Rarity: string;
  Set_ID: string;
  Set_Num: number;
  Card_Num: number;
  Image: string;
  Gamemode?: string; // "Lorcana" | "" | absent | "Illumineer's Quest"-style variants
}

export function isLorcanaCard(raw: RawBulkCard): boolean {
  // Missing/empty Gamemode means a regular Lorcana card (newer sets in the dump
  // stopped populating the field). Only an explicit non-Lorcana gamemode
  // (e.g. Illumineer's Quest) excludes the card.
  const gm = raw.Gamemode;
  return gm === undefined || gm.trim() === "" || gm.trim() === "Lorcana";
}

export function splitName(fullName: string): { name: string; subtitle?: string } {
  const idx = fullName.indexOf(" - ");
  if (idx === -1) return { name: fullName };
  return { name: fullName.slice(0, idx), subtitle: fullName.slice(idx + 3) };
}

export function parseColors(color: string): InkColor[] {
  return color
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is InkColor => INK_COLORS.includes(c));
}

export function parseType(type: string): CardType {
  if (type === "Action - Song") return "Action";
  if (type === "Character" || type === "Action" || type === "Item" || type === "Location") return type;
  throw new Error(`Unknown card type: ${type}`);
}

export function normalizeCard(raw: RawBulkCard): CardDefinition {
  const { name, subtitle } = splitName(raw.Name);
  const type = parseType(raw.Type);
  const classifications = (raw.Classifications ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.Type === "Action - Song" && !classifications.includes("Song")) classifications.push("Song");
  const def: CardDefinition = {
    id: raw.Unique_ID,
    name,
    ...(subtitle !== undefined ? { subtitle } : {}),
    fullName: raw.Name,
    type,
    colors: parseColors(raw.Color),
    cost: raw.Cost,
    inkable: raw.Inkable,
    ...(raw.Strength !== undefined ? { strength: raw.Strength } : {}),
    ...(raw.Willpower !== undefined ? { willpower: raw.Willpower } : {}),
    ...(raw.Lore !== undefined ? { lore: raw.Lore } : {}),
    ...(raw.Move_Cost !== undefined ? { moveCost: raw.Move_Cost } : {}),
    classifications,
    bodyText: raw.Body_Text ?? "",
    rarity: raw.Rarity,
    setId: raw.Set_ID,
    setNum: raw.Set_Num,
    cardNum: raw.Card_Num,
    imageUrl: raw.Image,
  };
  return def;
}

export function normalizeAll(rawCards: RawBulkCard[]): CardDefinition[] {
  const seen = new Set<string>();
  const out: CardDefinition[] = [];
  for (const raw of rawCards) {
    if (!isLorcanaCard(raw)) continue;
    if (seen.has(raw.Unique_ID)) continue; // defensive: bulk is unique, keep first
    seen.add(raw.Unique_ID);
    out.push(normalizeCard(raw));
  }
  return out;
}

export function main(): void {
  const raw = JSON.parse(readFileSync(RAW_PATH, "utf8")) as RawBulkCard[];
  const cards = normalizeAll(raw);
  mkdirSync(DIST_DATA_DIR, { recursive: true });
  const outPath = join(DIST_DATA_DIR, "cards.json");
  writeFileSync(outPath, JSON.stringify(cards, null, 1) + "\n");
  console.log(`normalize: ${raw.length} raw -> ${cards.length} cards -> ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
