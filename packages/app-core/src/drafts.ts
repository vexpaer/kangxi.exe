import type { DecisionAction, Memorial } from "@kangxi/protocol";

export interface DecisionDraft {
  memorial_id: string;
  action: DecisionAction;
  selected_option_id: string | null;
  comment: string;
  instructions: string;
  expected_version: number;
  idempotency_key: string;
  updated_at: string;
  conflict?: {
    server_memorial: Memorial;
    detected_at: string;
  };
}

/**
 * Keeps unsent or conflicted human rescripts intact until confirmed by the server.
 * On 409 version conflict, preserves the user's draft alongside the server's existing decision.
 */
export class OfflineDraftStore {
  private drafts = new Map<string, DecisionDraft>();

  get(memorialId: string): DecisionDraft | undefined {
    return this.drafts.get(memorialId);
  }

  list(): DecisionDraft[] {
    return Array.from(this.drafts.values());
  }

  save(draft: Omit<DecisionDraft, "updated_at">): DecisionDraft {
    const saved: DecisionDraft = {
      ...draft,
      updated_at: new Date().toISOString(),
    };
    this.drafts.set(draft.memorial_id, saved);
    return saved;
  }

  markConflict(memorialId: string, serverMemorial: Memorial): DecisionDraft | undefined {
    const existing = this.drafts.get(memorialId);
    if (!existing) return undefined;
    const updated: DecisionDraft = {
      ...existing,
      conflict: {
        server_memorial: serverMemorial,
        detected_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    this.drafts.set(memorialId, updated);
    return updated;
  }

  clear(memorialId: string): void {
    this.drafts.delete(memorialId);
  }

  serialize(): string {
    return JSON.stringify(Array.from(this.drafts.entries()));
  }

  hydrate(raw: string | null): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Array<[string, DecisionDraft]>;
      this.drafts = new Map(parsed);
    } catch {
      this.drafts = new Map();
    }
  }
}
