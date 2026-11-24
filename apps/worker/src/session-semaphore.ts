/**
 * Bounded async concurrency semaphore capping total active research/policy
 * model sessions across all worker jobs (`MAX_ACTIVE_SESSIONS`, default 6).
 *
 * Keeps multi-tenant `WORKER_CONCURRENCY` and the dedicated `policy_analyze`
 * runner from oversubscribing provider rate limits or worker container RAM.
 */

export const DEFAULT_MAX_ACTIVE_SESSIONS = 6;

export function parseMaxActiveSessions(raw: string | undefined = process.env.MAX_ACTIVE_SESSIONS): {
  value: number;
  valid: boolean;
} {
  if (raw === undefined || raw.trim() === '') {
    return { value: DEFAULT_MAX_ACTIVE_SESSIONS, valid: true };
  }
  const trimmed = raw.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? { value: parsed, valid: true }
    : { value: DEFAULT_MAX_ACTIVE_SESSIONS, valid: false };
}

export class SessionSemaphore {
  readonly maxPermits: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(maxPermits: number = DEFAULT_MAX_ACTIVE_SESSIONS) {
    if (!Number.isSafeInteger(maxPermits) || maxPermits < 1) {
      throw new RangeError(`SessionSemaphore maxPermits must be an integer >= 1, got ${maxPermits}`);
    }
    this.maxPermits = maxPermits;
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maxPermits) {
      this.active++;
      return this.makeReleaser();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active++;
    return this.makeReleaser();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private makeReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

let sharedSemaphore: SessionSemaphore | null = null;

/**
 * Shared process-wide session semaphore configured once from
 * `MAX_ACTIVE_SESSIONS` (default 6).
 */
export function getSharedSessionSemaphore(): SessionSemaphore {
  if (!sharedSemaphore) {
    sharedSemaphore = new SessionSemaphore(parseMaxActiveSessions(process.env.MAX_ACTIVE_SESSIONS).value);
  }
  return sharedSemaphore;
}

/** Reset the process-wide semaphore (used in tests). */
export function resetSharedSessionSemaphore(maxPermits?: number): SessionSemaphore {
  sharedSemaphore =
    maxPermits !== undefined
      ? new SessionSemaphore(maxPermits)
      : new SessionSemaphore(parseMaxActiveSessions(process.env.MAX_ACTIVE_SESSIONS).value);
  return sharedSemaphore;
}
