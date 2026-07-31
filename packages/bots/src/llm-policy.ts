/**
 * llm-policy.ts — LLM-driven decision policy over the Lorcana MCP tools.
 *
 * `llmChooseAction(view, legalActions)` sends a compact natural-language
 * rendering of the fog-of-war state plus the numbered legal actions to a local
 * Ollama model and returns the chosen legal action.
 *
 * The prompt is deliberately concise (only public info the seat can see) and
 * asks for a single integer index. If the model returns an invalid index,
 * we retry once with a stronger instruction, then fall back to the heuristic
 * policy so the match can continue.
 */
import { chooseAction } from "./policy.js";
import type { EnrichedCardInstance, LegalAction, PlayerAction, PlayerView } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LlmPolicyOptions {
  /** Ollama base URL. */
  ollamaUrl?: string;
  /** Model name known to Ollama. */
  model?: string;
  /** Temperature for generation. */
  temperature?: number;
  /** Max retries after an invalid response before falling back to heuristic. */
  maxRetries?: number;
  /** Optional hook for diagnostics. */
  onPrompt?: (prompt: string) => void;
}

const DEFAULT_MODEL = "llama3.2";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";

function oppOf(p: "p1" | "p2"): "p1" | "p2" {
  return p === "p1" ? "p2" : "p1";
}

function fmtCard(c: EnrichedCardInstance): string {
  const d = c.card;
  if (!d) return `${c.instanceId} (unknown)`;
  let s = `${d.fullName}`;
  if (d.type === "Character" && d.strength !== undefined && d.willpower !== undefined && d.lore !== undefined) {
    s += ` [${d.strength}/${d.willpower}/${d.lore} lore]`;
  } else if (d.type === "Location" && d.willpower !== undefined) {
    s += ` [loc ${d.willpower} WP, move ${d.moveCost ?? 1}]`;
  } else if (d.type === "Action") {
    s += ` [action]`;
  } else if (d.type === "Item") {
    s += ` [item]`;
  }
  s += ` cost ${d.cost}`;
  if (c.exerted) s += " (exerted)";
  if (c.damage > 0) s += ` (damage ${c.damage})`;
  return s;
}

function fmtZoneCards(cards: EnrichedCardInstance[] | { count: number }): string {
  if (!Array.isArray(cards)) return `×${cards.count}`;
  if (cards.length === 0) return "empty";
  return cards.map(fmtCard).join("; ");
}

function buildPrompt(view: PlayerView, legalActions: LegalAction[]): string {
  const me = view.players[view.you];
  const opp = view.players[oppOf(view.you)];

  const parts: string[] = [];
  parts.push("You are playing Disney Lorcana as an AI seat.");
  parts.push(`Turn ${view.turn}. Phase: ${view.phase}. Active player: ${view.activePlayer}. You are ${view.you}.`);
  parts.push(`Your lore: ${me.lore}/20. Opponent lore: ${opp.lore}/20.`);
  parts.push(`Your ink: ${me.inkAvailable}/${me.inkTotal} (played this turn: ${me.inkPlayedThisTurn}).`);
  parts.push("");

  parts.push("YOUR HAND:");
  parts.push(fmtZoneCards(me.hand as EnrichedCardInstance[]));
  parts.push("");

  parts.push("YOUR BOARD:");
  parts.push(fmtZoneCards(me.play));
  parts.push("");

  parts.push("OPPONENT BOARD:");
  parts.push(fmtZoneCards(opp.play));
  parts.push("");

  if (view.pendingChoice) {
    const c = view.pendingChoice;
    parts.push(`PENDING CHOICE: ${c.prompt} (pick ${c.min}-${c.max})`);
    for (const o of c.options) {
      parts.push(`  - ${o.id}: ${o.label}`);
    }
    parts.push("");
  }

  parts.push("LEGAL ACTIONS (reply with exactly one number):");
  legalActions.forEach((l, i) => {
    parts.push(`${i}: ${l.description}`);
  });
  parts.push("");

  parts.push("Choose the best action by responding with ONLY the integer index (e.g., 0, 1, 2...). Do not explain.");
  return parts.join("\n");
}

async function callOllama(
  prompt: string,
  opts: LlmPolicyOptions,
): Promise<string | null> {
  const base = (opts.ollamaUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = opts.model ?? DEFAULT_MODEL;
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.3,
        num_predict: 40,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { response?: string };
  return data.response ?? null;
}

function parseIndex(response: string, max: number): number | null {
  const cleaned = response.replace(/\[[^\]]*\]/g, "").trim();
  const m = cleaned.match(/\b(\d+)\b/);
  if (!m) return null;
  const idx = Number.parseInt(m[1], 10);
  if (idx < 0 || idx >= max) return null;
  return idx;
}

export async function llmChooseAction(
  view: PlayerView,
  legalActions: LegalAction[],
  opts: LlmPolicyOptions = {},
): Promise<PlayerAction> {
  if (legalActions.length === 0) return { type: "PASS" };
  if (legalActions.length === 1) return legalActions[0].action;

  const maxRetries = opts.maxRetries ?? 1;
  let prompt = buildPrompt(view, legalActions);
  if (opts.onPrompt) opts.onPrompt(prompt);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await callOllama(prompt, opts);
      if (response === null) throw new Error("empty LLM response");
      const idx = parseIndex(response, legalActions.length);
      if (idx !== null) return legalActions[idx].action;

      // Retry with a stricter reminder.
      prompt = `${prompt}\n\nYour previous response was not a valid index. Respond ONLY with an integer between 0 and ${legalActions.length - 1}.`;
    } catch (err) {
      // On final attempt fall through to heuristic.
      if (attempt === maxRetries) {
        console.error(`[llm-policy] inference failed on final attempt: ${err instanceof Error ? err.message : err}`);
        break;
      }
      await sleep(200);
    }
  }

  console.error("[llm-policy] falling back to heuristic policy");
  return chooseAction(view, legalActions);
}
