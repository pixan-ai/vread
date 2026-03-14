export class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiting.push(() => {
        this.active++;
        resolve();
      })
    );
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }
}

// Global rate limiters shared across concurrent requests
export const claudeLimit = new Semaphore(3);
export const elevenlabsLimit = new Semaphore(2);
