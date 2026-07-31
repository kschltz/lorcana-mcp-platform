// Seeded mulberry32 RNG with a serializable single-uint32 state (SPEC §3.4).
// All randomness in the engine flows through this class; state lives in
// GameState.rngState so serialized games stay deterministic.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current serializable state. */
  get state(): number {
    return this.s >>> 0;
  }

  /** Restore from a serialized state. */
  setState(state: number): void {
    this.s = state >>> 0;
  }

  /** Next uint32 (mulberry32). */
  nextUint(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    if (n <= 0) return 0;
    return this.nextUint() % n;
  }

  /** In-place Fisher–Yates shuffle (deterministic given the seed). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}
