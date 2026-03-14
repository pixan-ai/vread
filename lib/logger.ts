export type Trace = {
  id: string;
  info: (event: string, meta?: Record<string, unknown>) => void;
  warn: (event: string, meta?: Record<string, unknown>) => void;
  error: (event: string, meta?: Record<string, unknown>) => void;
  measure: <T>(event: string, fn: () => Promise<T>) => Promise<T>;
};

export function createTrace(): Trace {
  const id = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  function log(level: string, event: string, meta?: Record<string, unknown>) {
    const entry = { level, event, traceId: id, ms: Date.now() - t0, ...meta };
    if (level === "error") console.error(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
  }

  return {
    id,
    info: (event, meta) => log("info", event, meta),
    warn: (event, meta) => log("warn", event, meta),
    error: (event, meta) => log("error", event, meta),
    async measure(event, fn) {
      const start = Date.now();
      try {
        const result = await fn();
        log("info", event, { durationMs: Date.now() - start });
        return result;
      } catch (err) {
        log("error", event, { durationMs: Date.now() - start, error: String(err) });
        throw err;
      }
    },
  };
}
