export function isPendingRequest(request) {
  return (request?.status ?? 'pending') === 'pending';
}

export function pendingRequestDedupeKey(request) {
  const type = request?.type ?? 'human_handoff';
  const scope = type === 'human_handoff'
    ? 'conversation_handoff'
    : request?.gateKey
      ?? request?.gate_key
      ?? request?.contextSnapshot?.action
      ?? request?.context_snapshot?.action
      ?? request?.action
      ?? request?.title
      ?? 'default';
  return [request?.tenantId ?? '', request?.conversationId ?? '', type, normalize(scope)].join('|');
}

export function findOpenPendingRequest(state, candidate) {
  const key = pendingRequestDedupeKey(candidate);
  return (state?.pendingRequests ?? []).find((request) => (
    isPendingRequest(request) && pendingRequestDedupeKey(request) === key
  )) ?? null;
}

export function hasOpenHumanRequest(state, conversationId) {
  return (state?.pendingRequests ?? []).some((request) => (
    request.conversationId === conversationId
    && isPendingRequest(request)
    && ['human_handoff', 'approval.requested', 'decision.requested'].includes(request.type)
  ));
}

export function collapseDuplicateOpenPendingRequests(state, { now = new Date().toISOString() } = {}) {
  const canonicalByKey = new Map();
  const superseded = [];

  for (const request of state?.pendingRequests ?? []) {
    if (!isPendingRequest(request)) continue;
    const key = pendingRequestDedupeKey(request);
    const canonical = canonicalByKey.get(key);
    if (!canonical) {
      canonicalByKey.set(key, request);
      continue;
    }
    request.status = 'superseded';
    request.resolvedAt = now;
    request.resolutionNote = 'Solicitud duplicada consolidada con el caso abierto más reciente.';
    request.supersededBy = canonical.id;
    superseded.push(request.id);
  }

  return superseded;
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
