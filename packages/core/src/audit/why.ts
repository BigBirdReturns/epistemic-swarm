
/**
 * Why Query
 * =========
 *
 * Operator-legible provenance query for a belief.
 * Returns a minimal structured explanation suitable for logs, UI, or export.
 */

import { BeliefState } from '../types/index.js';
import { BeliefStore } from '../beliefs.js';

export interface WhyResult {
  claimHash: string;
  stance: BeliefState['stance'];
  confidence: number;
  lineage: string[];
  sources: string[];
  updatedAt: number;
}

export function why(beliefs: BeliefStore, claimHash: string): WhyResult | null {
  const b = beliefs.get(claimHash);
  if (!b) return null;

  const history = beliefs.getHistory(claimHash);
  const sources = new Set<string>();
  if (history) {
    for (const e of history.entries) sources.add(e.sourceId);
  }

  return {
    claimHash: b.claimHash,
    stance: b.stance,
    confidence: b.confidence,
    lineage: b.lineage ?? [],
    sources: Array.from(sources),
    updatedAt: b.updatedAt,
  };
}
