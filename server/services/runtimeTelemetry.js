import { performance } from 'node:perf_hooks';

const DEFAULT_SAMPLE_LIMIT = 4_000;
const DEFAULT_TRACE_LIMIT = 1_000;
const DEFAULT_SLOW_THRESHOLD_MS = 1_000;

function clock() {
  return performance.now();
}
function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function compactMetadata(metadata = {}) {
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item !== 'object')) {
      result[key] = value;
    }
  }
  return result;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
  return Number(ordered[index].toFixed(2));
}

function summarizeSamples(samples) {
  const durations = samples.map((sample) => sample.durationMs).filter((value) => Number.isFinite(value));
  const errors = samples.filter((sample) => sample.status === 'error').length;
  return {
    count: samples.length,
    errors,
    errorRate: samples.length ? Number((errors / samples.length).toFixed(4)) : 0,
    totalMs: Number(durations.reduce((total, value) => total + value, 0).toFixed(2)),
    avgMs: durations.length ? Number((durations.reduce((total, value) => total + value, 0) / durations.length).toFixed(2)) : null,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Number(Math.max(...durations).toFixed(2)) : null,
  };
}

export class RuntimeTelemetry {
  constructor({
    maxSamples = DEFAULT_SAMPLE_LIMIT,
    maxTraces = DEFAULT_TRACE_LIMIT,
    slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
    logTraces = true,
  } = {}) {
    this.maxSamples = Math.max(100, Number(maxSamples) || DEFAULT_SAMPLE_LIMIT);
    this.maxTraces = Math.max(50, Number(maxTraces) || DEFAULT_TRACE_LIMIT);
    this.slowThresholdMs = Math.max(0, Number(slowThresholdMs) || DEFAULT_SLOW_THRESHOLD_MS);
    this.logTraces = logTraces !== false;
    this.samples = [];
    this.completedTraces = [];
    this.activeTraces = new Map();
    this.gauges = new Map();
  }

  setGauge(name, value) {
    if (!name) return;
    this.gauges.set(name, { value: compactMetadata(value), at: new Date().toISOString() });
  }

  record(component, operation, {
    durationMs = null,
    status = 'ok',
    tenantId = null,
    traceId = null,
    metadata = {},
  } = {}) {
    const sample = {
      at: new Date().toISOString(),
      component,
      operation,
      durationMs: numberOrNull(durationMs),
      status,
      tenantId: tenantId ?? null,
      traceId: traceId ?? null,
      metadata: compactMetadata(metadata),
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
    if (this.logTraces && (status === 'error' || (sample.durationMs !== null && sample.durationMs >= this.slowThresholdMs))) {
      console.info('[telemetry]', JSON.stringify(sample));
    }
    return sample;
  }

  async measure(component, operation, metadata, work) {
    const started = clock();
    let status = 'ok';
    try {
      return await work();
    } catch (error) {
      status = 'error';
      throw error;
    } finally {
      this.record(component, operation, {
        durationMs: clock() - started,
        status,
        tenantId: metadata?.tenantId,
        traceId: metadata?.traceId,
        metadata,
      });
    }
  }

  startTrace({ traceId, tenantId = null, messageId = null, conversationId = null, source = null } = {}) {
    if (!traceId) return null;
    const existing = this.activeTraces.get(traceId);
    if (existing) return this.traceHandle(existing);
    const trace = {
      traceId,
      tenantId,
      messageId,
      conversationId,
      source,
      startedAt: clock(),
      startedAtIso: new Date().toISOString(),
      marks: [],
    };
    this.activeTraces.set(traceId, trace);
    return this.traceHandle(trace);
  }

  traceHandle(trace) {
    return {
      traceId: trace.traceId,
      mark: (name, metadata = {}) => {
        trace.marks.push({ name, atMs: Number((clock() - trace.startedAt).toFixed(2)), metadata: compactMetadata(metadata) });
      },
      span: (component, operation, metadata, work) => this.measure(component, operation, {
        ...metadata,
        tenantId: metadata?.tenantId ?? trace.tenantId,
        traceId: trace.traceId,
      }, work),
      complete: (status = 'ok', metadata = {}) => this.completeTrace(trace.traceId, status, metadata),
    };
  }

  completeTrace(traceId, status = 'ok', metadata = {}) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;
    this.activeTraces.delete(traceId);
    const summary = {
      at: new Date().toISOString(),
      traceId: trace.traceId,
      tenantId: trace.tenantId,
      messageId: trace.messageId,
      conversationId: trace.conversationId,
      source: trace.source,
      status,
      durationMs: Number((clock() - trace.startedAt).toFixed(2)),
      marks: trace.marks,
      metadata: compactMetadata(metadata),
    };
    this.completedTraces.push(summary);
    if (this.completedTraces.length > this.maxTraces) {
      this.completedTraces.splice(0, this.completedTraces.length - this.maxTraces);
    }
    this.record('trace', 'inbound', {
      durationMs: summary.durationMs,
      status,
      tenantId: trace.tenantId,
      traceId: trace.traceId,
      metadata: { source: trace.source, messageId: trace.messageId, conversationId: trace.conversationId },
    });
    if (this.logTraces) console.info('[telemetry.trace]', JSON.stringify(summary));
    return summary;
  }

  snapshot({ tenantId = null, tenantIds = null, sinceMs = null } = {}) {
    const cutoff = sinceMs !== null && sinceMs !== undefined && Number.isFinite(Number(sinceMs))
      ? Date.now() - Number(sinceMs)
      : null;
    const allowed = tenantIds ? new Set(tenantIds) : null;
    const visible = (item) => {
      // Infrastructure samples without a tenant (PostgreSQL snapshots, queue
      // drains) remain visible in a tenant-scoped diagnosis.
      if (tenantId && item.tenantId && item.tenantId !== tenantId) return false;
      if (allowed && item.tenantId && !allowed.has(item.tenantId)) return false;
      if (cutoff && Date.parse(item.at) < cutoff) return false;
      return true;
    };
    const samples = this.samples.filter(visible);
    const traces = this.completedTraces.filter((trace) => visible({ ...trace, at: trace.at }));
    const byOperation = new Map();
    for (const sample of samples) {
      const key = `${sample.component}.${sample.operation}`;
      const bucket = byOperation.get(key) ?? [];
      bucket.push(sample);
      byOperation.set(key, bucket);
    }
    return {
      generatedAt: new Date().toISOString(),
      filter: { tenantId, tenantIds: tenantIds ?? null, sinceMs: sinceMs ?? null },
      activeTraces: [...this.activeTraces.values()]
        .filter((trace) => visible({ ...trace, at: trace.startedAtIso }))
        .map((trace) => ({ traceId: trace.traceId, tenantId: trace.tenantId, messageId: trace.messageId, conversationId: trace.conversationId, source: trace.source, startedAt: trace.startedAtIso })),
      recentTraces: traces.slice(-100),
      operations: Object.fromEntries([...byOperation.entries()].map(([key, values]) => [key, summarizeSamples(values)])),
      gauges: Object.fromEntries(this.gauges.entries()),
    };
  }
}

