import express from 'express';

export function createApiRouter({ store, events, runtime, tools, controlPlane, usage, auth }) {
  const router = express.Router();

  router.get('/tenants', async (req, res, next) => {
    try {
      res.json(auth.filterTenantsForRequest(req, await readTenants(store)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/tools', (_req, res) => {
    res.json(store.getState().tools);
  });

  router.get('/conversations', async (req, res, next) => {
    try {
      const scope = authorizeTenantQuery(auth, req, req.query.tenantId);
      const conversations = await readConversations(store, { tenantId: req.query.tenantId });
      res.json(filterTenantScoped(conversations, scope));
    } catch (error) {
      next(error);
    }
  });

  router.get('/conversations/:id', async (req, res, next) => {
    try {
      const conversation = await readConversation(store, req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
      auth.authorizeTenant(req, conversation.tenantId);
      return res.json(conversation);
    } catch (error) {
      next(error);
    }
  });

  router.get('/events', async (req, res, next) => {
    try {
      const scope = authorizeTenantQuery(auth, req, req.query.tenantId);
      const records = await events.list({ tenantId: req.query.tenantId, limit: Number(req.query.limit ?? 80) });
      res.json(filterTenantScoped(records, scope));
    } catch (error) {
      next(error);
    }
  });

  router.get('/pending-requests', async (req, res, next) => {
    try {
      const scope = authorizeTenantQuery(auth, req, req.query.tenantId);
      const requests = await readPendingRequests(store, { tenantId: req.query.tenantId });
      res.json(enrichPendingRequests(filterTenantScoped(requests, scope), store.getState()));
    } catch (error) {
      next(error);
    }
  });

  router.get('/usage', async (req, res, next) => {
    try {
      const scope = authorizeTenantQuery(auth, req, req.query.tenantId);
      const tenants = scope
        ? (await readTenants(store)).filter((tenant) => scope.has(tenant.id))
        : req.query.tenantId
          ? (await readTenants(store)).filter((tenant) => tenant.id === req.query.tenantId)
          : await readTenants(store);
      const summaries = await Promise.all(tenants.map((tenant) => usage.summary(tenant.id, { period: req.query.period })));
      res.json(req.query.tenantId ? summaries[0] ?? null : summaries);
    } catch (error) {
      next(error);
    }
  });

  router.post('/pending-requests/:id/resolve', async (req, res, next) => {
    try {
      const request = store.getState().pendingRequests.find((item) => item.id === req.params.id);
      if (request) auth.authorizeTenant(req, request.tenantId, { roles: ['owner', 'operator'] });
      const resolved = await runtime.resolveHumanRequest(req.params.id, req.body ?? {});
      auth.recordTenantAction(req, {
        tenantId: resolved.tenantId,
        action: 'pending_request.resolve',
        resource: req.params.id,
        metadata: { outcome: req.body?.outcome, approverId: req.body?.approverId, responseMode: req.body?.responseMode },
      });
      res.json(resolved);
    } catch (error) {
      next(error);
    }
  });

  router.get('/ops/overview', async (req, res, next) => {
    try {
      const tenants = await readTenants(store);
      const visibleTenants = auth.filterTenantsForRequest(req, tenants);
      const tenantId = req.query.tenantId ?? visibleTenants[0]?.id;
      if (tenantId) auth.authorizeTenant(req, tenantId);
      const conversations = await readConversations(store, { tenantId });
      const pendingRequests = enrichPendingRequests(
        (await readPendingRequests(store, { tenantId })).filter((item) => item.status === 'pending'),
        store.getState(),
      );
      const filteredEvents = await events.list({ tenantId, limit: 50 });
      const state = store.getState();
      const usageSummary = tenantId ? await usage.summary(tenantId) : null;
      res.json({
      tenants: visibleTenants,
      tenant: visibleTenants.find((item) => item.id === tenantId),
      conversations,
      pendingRequests,
      events: filteredEvents,
      usage: usageSummary,
      tools: deriveTenantToolStatuses(state, tenantId),
      metrics: {
        active: conversations.filter((item) => ['live', 'degraded'].includes(item.status)).length,
        completed: conversations.filter((item) => item.status === 'completed').length,
        pending: pendingRequests.length,
        failed: conversations.filter((item) => ['blocked', 'degraded'].includes(item.status)).length,
        response: 'contract',
        conversion: `${Math.round((conversations.filter((item) => item.value !== 'Pendiente').length / Math.max(conversations.length, 1)) * 100)}%`,
      },
    });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/tenants/:tenantId/config', (req, res, next) => {
    try {
    auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
    let tenant;
    store.mutate((state) => {
      tenant = state.tenants.find((item) => item.id === req.params.tenantId);
      if (!tenant) return;
      tenant.config = mergeConfig(tenant.config, req.body ?? {});
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (req.body?.whatsapp?.phoneNumberId) controlPlane?.completeOnboardingStep(req.params.tenantId, 'whatsapp');
    events.emit({ type: 'tool.binding.changed', tenantId: tenant.id, detail: 'Tenant configuration updated' });
    auth.recordTenantAction(req, {
      tenantId: tenant.id,
      action: 'tenant.config.update',
      resource: 'tenant.config',
      metadata: { sections: Object.keys(req.body ?? {}) },
    });
    return res.json(tenant);
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/run', async (req, res, next) => {
    try {
      const tenantId = req.body?.tenantId ?? store.getState().tenants[0]?.id;
      auth.authorizeTenant(req, tenantId, { roles: ['owner', 'operator'] });
      controlPlane?.requireTenantOperational(tenantId);
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
      auth.authorizeTenant(req, tenantId, { roles: ['owner', 'operator'] });
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

function deriveTenantToolStatuses(state, tenantId) {
  if (!tenantId) return state.tools;
  const tenant = state.tenants.find((item) => item.id === tenantId);
  const googleConnection = state.googleConnectionsByTenant?.[tenantId];
  const googleWorkspace = state.googleWorkspacesByTenant?.[tenantId];
  const whatsappBinding = state.whatsappBindingsByTenant?.[tenantId];
  const googleReady = googleConnection?.status === 'connected' && googleWorkspace?.status === 'provisioned';
  const googleStatus = googleReady
    ? googleWorkspace?.mode === 'live' || googleConnection?.mode === 'live'
      ? 'production_ready'
      : 'sandbox_ready'
    : 'needs_binding';
  const whatsappReady = Boolean(tenant?.config?.whatsapp?.phoneNumberId || whatsappBinding?.phoneNumberId);
  const whatsappStatus = whatsappReady ? 'production_ready' : 'needs_binding';
  const googleToolNames = new Set([
    'google_sheets_read_table',
    'google_drive_file_picker',
    'google_sheets_customer_profile_lookup',
    'google_sheets_customer_profile_upsert',
    'google_sheets_order_write',
    'google_drive_customer_profile_lookup',
    'google_drive_customer_profile_upsert',
  ]);

  return state.tools.map((tool) => {
    if (googleToolNames.has(tool.name)) {
      return {
        ...tool,
        status: googleStatus,
        providerMode: googleReady ? googleWorkspace?.mode ?? googleConnection?.mode ?? tool.providerMode : tool.providerMode,
        source: googleReady ? tenantToolSource(tool, googleWorkspace) : tool.source,
      };
    }
    if (tool.name === 'whatsapp_business_messaging') {
      return {
        ...tool,
        status: whatsappStatus,
        providerMode: whatsappReady ? 'tenant_binding' : tool.providerMode,
        source: whatsappReady ? 'WhatsApp Business conectado' : tool.source,
      };
    }
    return tool;
  });
}

function tenantToolSource(tool, googleWorkspace) {
  const spreadsheetId = googleWorkspace?.spreadsheet?.id;
  const rootFolderId = googleWorkspace?.rootFolder?.id;
  if (tool.name.includes('drive')) return rootFolderId ? `Drive ${rootFolderId}` : 'Drive aprovisionado';
  if (tool.name.includes('sheets')) return spreadsheetId ? `Sheets ${spreadsheetId}` : 'Sheets aprovisionado';
  return tool.source;
}

async function readTenants(store) {
  return store.listTenants ? store.listTenants() : store.getState().tenants;
}

async function readConversations(store, { tenantId } = {}) {
  if (store.listConversations) return store.listConversations({ tenantId });
  return store.getState().conversations.filter((item) => !tenantId || item.tenantId === tenantId);
}

async function readConversation(store, conversationId) {
  if (store.getConversation) return store.getConversation(conversationId);
  return store.getState().conversations.find((item) => item.id === conversationId);
}

async function readPendingRequests(store, { tenantId } = {}) {
  if (store.listPendingRequests) return store.listPendingRequests({ tenantId });
  return store.getState().pendingRequests.filter((item) => !tenantId || item.tenantId === tenantId);
}

function authorizeTenantQuery(auth, req, tenantId) {
  if (tenantId) {
    auth.authorizeTenant(req, tenantId);
    return null;
  }
  if (auth.config.authRequired || req.auth?.user) {
    auth.requireSession(req);
    return new Set(auth.tenantIdsForRequest(req));
  }
  return null;
}

function filterTenantScoped(records, scope) {
  if (!scope) return records;
  return records.filter((item) => scope.has(item.tenantId));
}

function enrichPendingRequests(requests, state) {
  return requests.map((request) => {
    if (request.contextSnapshot?.items?.length || request.context_snapshot?.items?.length) return request;
    const title = String(request.title ?? '').toLowerCase();
    const looksLikeDelivery = request.assignedTeam === 'operaciones' || title.includes('pedido') || title.includes('domicilio');
    if (!looksLikeDelivery) return request;
    const order = (state.ordersByTenant?.[request.tenantId] ?? []).find((item) => item.conversationId === request.conversationId);
    if (!order) return request;
    return {
      ...request,
      action: 'prepare_delivery_order',
      title: request.title?.toLowerCase().includes('alistar') ? request.title : 'Alistar domicilio confirmado',
      consequence: 'El tendero toma el pedido para alistarlo y coordinar la entrega.',
      contextSnapshot: {
        ...(request.contextSnapshot ?? request.context_snapshot ?? {}),
        action: 'prepare_delivery_order',
        orderId: order.id,
        subtotal: order.subtotal,
        customerName: order.customerName,
        customerWaId: order.waId,
        deliveryAddress: order.deliveryAddress ?? 'Dirección pendiente por confirmar',
        items: order.items ?? [],
      },
    };
  });
}

function mergeConfig(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeConfig(output[key] ?? {}, value) : value;
  }
  return output;
}
