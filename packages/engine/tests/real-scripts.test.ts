import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCardScript, type CardScript } from "../src/index.js";

// Locate the generated scripts.json from the card-data package: prefer the
// repo-relative location (post-merge layout), fall back to the absolute
// project path used in the build environment.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(here, "../../../card-data/dist-data/scripts.json"), // packages/engine/tests → packages/card-data
  path.resolve(here, "../../../../packages/card-data/dist-data/scripts.json"),
  "/mnt/agents/output/project/packages/card-data/dist-data/scripts.json",
];
const scriptsPath = candidates.find((p) => existsSync(p));

function loadScripts(): Record<string, CardScript> {
  return JSON.parse(readFileSync(scriptsPath!, "utf8")) as Record<string, CardScript>;
}

describe.skipIf(!scriptsPath)("real generated scripts (card-data dist-data)", () => {
  it("~20 sampled real scripts validate against the CardScript schema (incl. all DSL extensions)", () => {
    const all = loadScripts();
    const entries = Object.entries(all);
    expect(entries.length).toBeGreaterThan(2000);

    const uses = (s: CardScript, needle: string) => JSON.stringify(s).includes(needle);
    // prioritize scripts exercising each DSL extension, then fill up to 20
    const picked = new Map<string, CardScript>();
    for (const [id, s] of entries) if (uses(s, '"self":true')) picked.set(id, s);
    for (const [id, s] of entries) if (uses(s, '"who":"opponent"')) picked.set(id, s);
    for (const [id, s] of entries) if (uses(s, '"source":"self"')) picked.set(id, s);
    for (const [id, s] of entries) if (uses(s, '"PUT_INTO_INKWELL"')) picked.set(id, s);
    for (const [id, s] of entries) { if (picked.size >= 20) break; picked.set(id, s); }
    const sample = [...picked.entries()].slice(0, 20);

    expect(sample.some(([, s]) => uses(s, '"self":true'))).toBe(true);
    const failures: string[] = [];
    for (const [id, script] of sample) {
      const errs = validateCardScript(script);
      if (errs.length > 0) failures.push(`${id}: ${errs.join("; ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("keyword-only vanilla-tier scripts are schema-valid and playable", () => {
    const all = loadScripts();
    const keywordOnly = Object.values(all).filter(
      (s) => !s.triggered?.length && !s.activated?.length && !s.continuous?.length,
    );
    expect(keywordOnly.length).toBeGreaterThan(500);
    for (const s of keywordOnly.slice(0, 25)) {
      expect(validateCardScript(s)).toEqual([]);
    }
  });
});
