import { z } from 'zod';
import { fail, ok, present } from './result.ts';

export const PauseScope = z.enum(['reminders', 'dcTransfers', 'both']);

/** Reason field shared by the pause write tools. */
export const PauseReason = z.string().min(1).max(255);

const Pause = z.record(z.string(), z.unknown());

/** Tool result for one pause payload: temporalWorkflowId (internal plumbing) removed, compacted, redacted. */
export function pauseResult(payload: unknown, revealPii: boolean) {
  const parsed = Pause.safeParse(payload);
  if (!parsed.success) return fail('UPSTREAM_ERROR: Unexpected pause payload from the Inio API.');
  const { temporalWorkflowId: _, ...pause } = parsed.data;
  return ok(present(pause, revealPii));
}
