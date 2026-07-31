import { MOCK_MATCHES, getMockState } from "./mock";
import type { GameState, MatchSummary, PlayerId } from "./types";

const POLL_INTERVAL_MS = 3000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Tolerantly normalize a /api/matches entry into a MatchSummary. */
function normalizeMatch(raw: Record<string, unknown>): MatchSummary {
  const players = (raw.players ?? {}) as Record<string, { lore?: number }>;
  const scores =
    (raw.scores as { p1?: number; p2?: number } | undefined) ??
    ({
      p1: players.p1?.lore ?? 0,
      p2: players.p2?.lore ?? 0,
    } satisfies { p1: number; p2: number });
  const winner = (raw.winner as PlayerId | undefined) ?? undefined;
  const phase = String(raw.phase ?? (winner ? "game-over" : "main"));
  return {
    matchId: String(raw.matchId ?? raw.id ?? "unknown"),
    live: (raw.live as boolean | undefined) ?? phase !== "game-over",
    turn: Number(raw.turn ?? 0),
    phase,
    scores: { p1: scores.p1 ?? 0, p2: scores.p2 ?? 0 },
    winner,
    winReason: raw.winReason as string | undefined,
    createdAt: raw.createdAt as string | undefined,
  };
}

/**
 * List live/finished matches. Falls back to the bundled mock lobby when the
 * spectator API is unreachable (offline demo mode).
 */
export async function listMatches(): Promise<MatchSummary[]> {
  try {
    const raw = await fetchJson<unknown>("/api/matches");
    const arr = Array.isArray(raw)
      ? raw
      : ((raw as { matches?: unknown[] }).matches ?? []);
    return arr.map((m) => normalizeMatch(m as Record<string, unknown>));
  } catch {
    return MOCK_MATCHES;
  }
}

/**
 * Fetch the full spectatorView for a match. Falls back to the mock fixture
 * when the server is unreachable.
 */
export async function getState(matchId: string): Promise<GameState> {
  try {
    return await fetchJson<GameState>(`/api/matches/${matchId}/state`);
  } catch {
    return getMockState(matchId);
  }
}

export interface Subscription {
  close: () => void;
}

/**
 * Subscribe to live spectatorView updates for a match.
 *
 * Primary channel: SSE at GET /api/matches/:id/stream (EventSource
 * auto-reconnects natively on dropped connections).
 * Fallback: whenever the SSE channel is not OPEN (server down, proxy
 * buffering, initial connect failure), poll the REST state endpoint every
 * 3s so the board never goes stale. If both channels fail (fully offline),
 * the mock fixture is served once so the app remains demoable.
 */
export function subscribeStream(
  matchId: string,
  cb: (state: GameState) => void,
): Subscription {
  let closed = false;
  let servedMock = false;
  let lastSerialized = "";

  const emit = (state: GameState) => {
    if (closed) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSerialized) return; // dedupe identical pushes
    lastSerialized = serialized;
    cb(state);
  };

  const source = new EventSource(`/api/matches/${matchId}/stream`);
  // The server emits named events: `event: state`. Listen for that name.
  const onState = (ev: MessageEvent) => {
    try {
      emit(JSON.parse(ev.data) as GameState);
    } catch {
      // ignore malformed SSE payloads
    }
  };
  source.addEventListener("state", onState);
  // Fallback for unnamed messages if the server ever drops the event name.
  source.onmessage = (ev) => {
    try {
      emit(JSON.parse(ev.data) as GameState);
    } catch {
      // ignore malformed SSE payloads
    }
  };
  source.onerror = () => {
    // EventSource retries on its own; polling below covers the gap.
    if (!servedMock && source.readyState === EventSource.CLOSED) {
      servedMock = true;
      emit(getMockState(matchId));
    }
  };

  const poll = window.setInterval(async () => {
    if (closed) return;
    if (source.readyState === EventSource.OPEN) return; // SSE healthy
    try {
      emit(await fetchJson<GameState>(`/api/matches/${matchId}/state`));
    } catch {
      if (!servedMock) {
        servedMock = true;
        emit(getMockState(matchId));
      }
    }
  }, POLL_INTERVAL_MS);

  return {
    close: () => {
      closed = true;
      window.clearInterval(poll);
      source.close();
    },
  };
}
