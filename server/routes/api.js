import express from 'express';

export function createApiRouter({ store, events, runtime, tools }) {
  const router = express.Router();

  router.get('/tenants', (_req, res) => {
    res.json(store.getState().tenants);
  });

  router.get('/tools', (_req, res) => {
    res.json(store.getState().tools);
  });

  router.get('/conversations', (req, res) => {
    const tenantId = req.query.tenantId;
    res.json(store.getState().conversations.filter((item) => !tenantId || item.tenantId === tenantId));
  });

  router.get('/conversations/:id', (req, res) => {
    const conversation = store.getState().conversations.find((item) => item.id === req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    return res.json(conversation);
  });

  router.get('/events', (req, res) => {
    res.json(events.list({ tenantId: req.query.tenantId, limit: Number(req.query.limit ?? 80) }));
  });

  router.get('/pending-requests', (req, res) => {
    const tenantId = req.query.tenantId;
    res.json(store.getState().pendingRequests.filter((item) => !tenantId || item.tenantId === tenantId));
  });

  router.post('/pending-requests/:id/resolve', (req, res, next) => {
    try {
      const request = runtime.resolveHumanRequest(req.params.id, req.body ?? {});
      res.json(request);
    } catch (error) {
      next(error);
    }
  });

  router.get('/ops/overview', (req, res) => {
    const tenantId = req.query.tenantId ?? store.getState().tenants[0]?.id;
    const state = store.getState();
    const conversations = state.conversations.filter((item) => item.tenantId === tenantId);
    const pendingRequests = state.pendingRequests.filter((item) => item.tenantId === tenantId && item.status === 'pending');
    const filteredEvents = state.events.filter((item) => item.tenantId === tenantId).slice(0, 50);
    res.json({
      tenants: state.tenants,
      tenant: state.tenants.find((item) => item.id === tenantId),
      conversations,
      pendingRequests,
      events: filteredEvents,
      tools: state.tools,
      metrics: {
        active: conversations.filter((item) => ['live', 'degraded'].includes(item.status)).length,
        completed: conversations.filter((item) => item.status === 'completed').length,
        pending: pendingRequests.length,
        failed: conversations.filter((item) => ['blocked', 'degraded'].includes(item.status)).length,
        response: 'contract',
        conversion: `${Math.round((conversations.filter((item) => item.value !== 'Pendiente').length / Math.max(conversations.length, 1)) * 100)}%`,
      },
    });
  });

  router.patch('/tenants/:tenantId/config', (req, res) => {
    let tenant;
    store.mutate((state) => {
      tenant = state.tenants.find((item) => item.id === req.params.tenantId);
      if (!tenant) return;
      tenant.config = mergeConfig(tenant.config, req.body ?? {});
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    events.emit({ type: 'tool.binding.changed', tenantId: tenant.id, detail: 'Tenant configuration updated' });
    return res.json(tenant);
  });

  router.post('/agent/run', async (req, res, next) => {
    try {
      const tenantId = req.body?.tenantId ?? store.getState().tenants[0]?.id;
      const result = await runtime.processInbound({
        provider: 'local_api',
        tenantId,
        workspaceId: tenantId,
        waId: req.body?.waId ?? `local-${Date.now()}`,
        profileName: req.body?.profileName ?? 'Cliente local',
        phoneNumberId: req.body?.phoneNumberId,
        messageId: req.body?.messageId ?? `local-${crypto.randomUUID()}`,
        timestamp: Date.now(),
        messageType: req.body?.messageType ?? 'text',
        text: req.body?.text ?? '',
        mediaRef: req.body?.mediaRef ?? null,
        rawPayloadRef: 'local_api',
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tools/:toolName/smoke-test', async (req, res, next) => {
    try {
      const tenantId = req.body?.tenantId ?? store.getState().tenants[0]?.id;
      const result = await tools.call(req.params.toolName, tenantId, 'smoke-test', req.body?.payload ?? {});
      store.mutate((state) => {
        const tool = state.tools.find((item) => item.name === req.params.toolName || item.key === req.params.toolName);
        if (tool) tool.lastSmokeTest = { status: 'success', at: new Date().toISOString() };
      });
      res.json({ status: 'success', result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function mergeConfig(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeConfig(output[key] ?? {}, value) : value;
  }
  return output;
}
