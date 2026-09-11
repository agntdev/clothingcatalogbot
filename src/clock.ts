/** A single clock seam for timestamps and expiring conversation state. */
let readClock: () => number = () => Date.now();

export function now(): number {
  return readClock();
}

/** Test hook for deterministic expiry checks. Production code never changes it. */
export function setClockForTests(clock: (() => number) | undefined): void {
  readClock = clock ?? (() => Date.now());
}
