import { useEffect, useState } from "react";
import { Board } from "./components/Board";
import { MatchPicker } from "./components/MatchPicker";

type Route = { page: "lobby" } | { page: "match"; matchId: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const m = hash.match(/^\/match\/([^/]+)$/);
  if (m) return { page: "match", matchId: decodeURIComponent(m[1]) };
  return { page: "lobby" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="app-brand" href="#/">
          <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.5 C8 1.5 3 7 3 10.2 a5 5 0 0 0 10 0 C13 7 8 1.5 8 1.5 Z"
              fill="none"
              stroke="#d9a441"
              strokeWidth="1.4"
            />
            <circle cx="8" cy="10.2" r="1.6" fill="#d9a441" />
          </svg>
          Lorcana <span>Spectator</span>
        </a>
        {route.page === "match" && (
          <a className="app-back" href="#/">
            ← Lobby
          </a>
        )}
      </header>
      <main className="app-main">
        {route.page === "lobby" ? (
          <MatchPicker />
        ) : (
          <Board key={route.matchId} matchId={route.matchId} />
        )}
      </main>
    </div>
  );
}
