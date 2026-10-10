export class EventService {
  constructor(store) {
    this.store = store;
  }

  emit({ type, tenantId, conversationId = 'system', detail, metadata = {} }) {
    const event = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      type,
      tenantId,
      conversationId,
      detail,
      metadata,
    };
    this.store.mutate((state) => {
      state.events.unshift(event);
      state.events = state.events.slice(0, 500);
    });
    this.store.persistEvent?.(event);
    return event;
  }

  async list({ tenantId, limit = 50 }) {
    if (this.store.listEvents) return this.store.listEvents({ tenantId, limit });
    return this.store
      .getState()
      .events.filter((event) => !tenantId || event.tenantId === tenantId)
      .slice(0, limit);
  }
}
