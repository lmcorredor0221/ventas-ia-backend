const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 8;

export class IntegrationOutbox {
  constructor({ store, config = {}, handlers = {} }) {
    this.store = store;
    this.handlers = handlers;
    this.enabled = Boolean(config.integrationOutboxEnabled);
    this.intervalMs = Number(config.integrationOutboxIntervalMs ?? DEFAULT_INTERVAL_MS);
    this.batchSize = Number(config.integrationOutboxBatchSize ?? DEFAULT_BATCH_SIZE);
    this.maxAttempts = Number(config.integrationOutboxMaxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.timer = null;
    this.running = false;
  }

  register(kind, handler) {
    if (!kind || typeof handler !== 'function') throw new Error('Outbox handler requires a kind and function');
    this.handlers[kind] = handler;
    return this;
  }

  createEntry({ tenantId = null, kind, aggregateType = null, aggregateId = null, idempotencyKey, payload = {} }) {
    if (!kind || !idempotencyKey) throw new Error('Outbox entries require kind and idempotencyKey');
    const now = new Date().toISOString();
    return {
      id: `outbox-${crypto.randomUUID()}`,
      tenantId,
      kind,
      aggregateType,
      aggregateId,
      idempotencyKey,
      payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: now,
      lockedAt: null,
      processedAt: null,
    };
  }

  async enqueue(args) {
    return this.store.enqueueOutbox(this.createEntry(args));
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.drain().catch((error) => console.error('Integration outbox drain failed:', error.message));
    }, this.intervalMs);
    this.timer.unref?.();
    this.drain().catch((error) => console.error('Integration outbox initial drain failed:', error.message));
  }

  async drain() {
    if (!this.enabled || this.running || !this.store.claimOutbox) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      const entries = await this.store.claimOutbox({ limit: this.batchSize });
      for (const entry of entries) {
        const handler = this.handlers[entry.kind];
        try {
          if (!handler) throw new Error(`No outbox handler registered for ${entry.kind}`);
          const result = await handler(entry);
          await this.store.completeOutbox(entry.id, result);
          processed += 1;
        } catch (error) {
          const failed = await this.store.failOutbox(entry.id, error, { maxAttempts: this.maxAttempts });
          if (entry.kind === 'whatsapp.inbound_processing' && failed?.status === 'failed') {
            await this.store.failInboundMessage?.(entry.payload.messageId, error, { terminal: true });
          }
        }
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.enabled) await this.drain();
  }
}

export function exponentialBackoff(attempts) {
  return Math.min(15 * 60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}
