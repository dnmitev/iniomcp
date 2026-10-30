import { z } from 'zod';
import { acceptedUnreadable, fail, ok, present } from './result.ts';

export const PauseScope = z.enum(['reminders', 'dcTransfers', 'both']);

/** Reason field shared by the pause write tools. */
export const PauseReason = z.string().min(1).max(255);

const Pause = z.record(z.string(), z.unknown());

/** Tool result for one pause payload (a bad shape after a write is an accepted write, else an error): temporalWorkflowId (internal plumbing) removed, compacted, redacted. */
export function pauseResult(payload: unknown, revealPii: boolean, afterWrite = false) {
  const parsed = Pause.safeParse(payload);
  if (!parsed.success)
    return afterWrite
      ? acceptedUnreadable()
      : fail('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  const { temporalWorkflowId: _, ...pause } = parsed.data;
  return ok(present(pause, revealPii));
}
