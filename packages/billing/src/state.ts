import { ConflictError } from "@brightloop/shared";

export const SUBSCRIPTION_TRANSITIONS: Record<string, string[]> = {
  PENDING_ACTIVATION: ["PENDING_CHARGE", "TRIAL_ACTIVE", "ACTIVE", "CANCELLED", "ERRORED"],
  PENDING_CHARGE: ["ACTIVE", "CANCELLED", "ERRORED"],
  TRIAL_ACTIVE: ["ACTIVE", "TRIAL_EXPIRED", "CANCELLED", "ERRORED"],
  TRIAL_EXPIRED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "SUSPENDED", "CANCELLED", "COMPLETED", "SUPERSEDED", "ERRORED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: ["COMPLETED"],
  COMPLETED: [],
  SUPERSEDED: [],
  ERRORED: ["ACTIVE", "CANCELLED"],
};

export function assertSubscriptionTransition(from: string, to: string): void {
  const allowed = SUBSCRIPTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ConflictError(`cannot transition subscription from ${from} to ${to}`);
  }
}

export const INVOICE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["FINALIZED", "VOID"],
  FINALIZED: ["UNCOLLECTIBLE", "VOID", "PAID"],
  UNCOLLECTIBLE: ["VOID", "PAID"],
  VOID: [],
  PAID: [],
};

export function assertInvoiceTransition(from: string, to: string): void {
  if (!(INVOICE_TRANSITIONS[from] ?? []).includes(to)) {
    throw new ConflictError(`cannot transition invoice from ${from} to ${to}`);
  }
}

export const CREDIT_NOTE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["APPLIED", "VOID"],
  APPLIED: ["VOID"],
  VOID: [],
};

export function assertCreditNoteTransition(from: string, to: string): void {
  if (!(CREDIT_NOTE_TRANSITIONS[from] ?? []).includes(to)) {
    throw new ConflictError(`cannot transition credit note from ${from} to ${to}`);
  }
}
