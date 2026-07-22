/**
 * Tabu List — Prevents ping-pong oscillations between equivalent states
 * Pure, solver-ready
 */

export class TabuList {
  private map: Map<string, number>; // stateHash -> iteration added
  private maxSize: number;
  private tenure: number; // how long a state remains tabu
  private currentIteration: number;

  constructor(maxSize: number = 100, tenure: number = 20) {
    this.map = new Map();
    this.maxSize = maxSize;
    this.tenure = tenure;
    this.currentIteration = 0;
  }

  /**
   * Generate a hash for assignments (fast, not cryptographic)
   * For simplicity, we hash only changed personnel/days
   */
  static hashAssignments(assignments: Record<string, Record<number, string>>): string {
    // Simple deterministic JSON stringify sorted
    const keys = Object.keys(assignments).sort();
    let str = '';
    for (const k of keys) {
      str += k + ':';
      const days = Object.keys(assignments[k]).sort((a, b) => parseInt(a) - parseInt(b));
      for (const d of days) {
        str += `${d}=${assignments[k][parseInt(d)]};`;
      }
      str += '|';
    }
    // Simple hash (djb2)
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash.toString(16);
  }

  setIteration(iter: number): void {
    this.currentIteration = iter;
  }

  isTabu(stateHash: string): boolean {
    const addedAt = this.map.get(stateHash);
    if (addedAt === undefined) return false;
    // If tenure expired, not tabu anymore
    if (this.currentIteration - addedAt > this.tenure) {
      this.map.delete(stateHash);
      return false;
    }
    return true;
  }

  add(stateHash: string): void {
    if (this.map.size >= this.maxSize) {
      // Remove oldest (first inserted)
      const firstKey = this.map.keys().next().value;
      if (firstKey) this.map.delete(firstKey);
    }
    this.map.set(stateHash, this.currentIteration);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/**
 * Helper: check if a move would cause oscillation
 */
export function wouldCauseOscillation(
  tabu: TabuList,
  assignments: Record<string, Record<number, string>>
): boolean {
  const hash = TabuList.hashAssignments(assignments);
  return tabu.isTabu(hash);
}
