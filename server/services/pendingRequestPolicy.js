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
  return getPendingConversationMode(state, conversationId).mode === 'human_takeover';
}

// A commercial approval is a gate on one action, not a takeover of the whole
// dialogue. Only a real human handoff pauses the agent so the buyer never
// receives concurrent answers from the store and VIA.
export function getPendingConversationMode(state, conversationId) {
  const pending = (state?.pendingRequests ?? []).filter((request) => (
    request.conversationId === conversationId && isPendingRequest(request)
  ));
  const humanRequest = pending.find((request) => request.type === 'human_handoff');
  if (humanRequest) return { mode: 'human_takeover', request: humanRequest };
  const approvalRequest = pending.find((request) => ['approval.requested', 'decision.requested'].includes(request.type));
  if (approvalRequest) return { mode: 'approval_pending', request: approvalRequest };
  return { mode: 'none', request: null };
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
