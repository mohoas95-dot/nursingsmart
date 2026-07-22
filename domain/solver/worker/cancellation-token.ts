/**
 * Cancellation Token — Prevents race conditions & allows UI locks
 * Pure, solver-ready
 */

export class CancellationToken {
  private _isCancelled = false;
  private _listeners: Array<() => void> = [];

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const listener of this._listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  onCancelled(callback: () => void): void {
    this._listeners.push(callback);
    if (this._isCancelled) {
      callback();
    }
  }

  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new Error('Cancelled');
    }
  }

  static create(): { token: CancellationToken; cancel: () => void } {
    const token = new CancellationToken();
    return {
      token,
      cancel: () => token.cancel(),
    };
  }
}

/**
 * UI Lock — Prevents manual overrides during background processing
 */
export class SolverUILock {
  private locked = false;
  private owner: string | null = null;

  acquire(owner: string): boolean {
    if (this.locked) return false;
    this.locked = true;
    this.owner = owner;
    return true;
  }

  release(owner: string): boolean {
    if (!this.locked) return false;
    if (this.owner !== owner) return false;
    this.locked = false;
    this.owner = null;
    return true;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getOwner(): string | null {
    return this.owner;
  }
}
