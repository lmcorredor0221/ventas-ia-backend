import crypto from 'node:crypto';
import { isClosedConversation } from '../domain/conversationStatus.js';

// Import provider history/human activity without entering the LLM or creating orders.
export async function processCoexistenceEvent(runtime, normalized) {
  const { store } = runtime;
  const { field, value, timestamp } = normalized.coexistenceEvent;
  const tenantId = normalized.tenantId;
  const state = store.getState();
  const tenant = state.tenants.find(t => t.id === tenantId);
  if (!tenant) throw new Error('Unknown tenant for coexistence event');
  const now = new Date().toISOString();
  if (field === 'account_update') {
    const time = Number(timestamp ?? 0) * 1000;
    if (time > 0 && time >= (Date.parse(tenant.config.whatsapp.accountEventAt ?? '') || 0)) {
      store.mutate(() => {
        tenant.config.whatsapp.accountEventAt = new Date(time).toISOString();
        tenant.config.whatsapp.accountEvent = value.event;
        if (['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'].includes(value.event)) tenant.config.whatsapp.accessRevokedAt = new Date(time).toISOString();
        // Reconnect notification alone cannot validate a replacement token.
      });
      // The WhatsApp checkpoint below persists this projection and detects
      // stale writes. A generic tenant merge first could erase a revocation.
      if (!store.persistWhatsAppOnboarding) await store.persistTenantCritical?.(tenantId);
    }
  } else if (field === 'smb_app_state_sync') {
    store.mutate(s => {
      s.whatsappOnboardingByTenant[tenantId] ??= { tenantId };
      const contacts = s.whatsappOnboardingByTenant[tenantId].contacts ??= {};
      for (const entry of value.state_sync ?? []) {
        if (entry.type !== 'contact' || !entry.contact?.phone_number || !['add','remove'].includes(entry.action)) continue;
        const waId = entry.contact.phone_number;
        const changedAt = Number(entry.metadata?.timestamp ?? 0);
        if (changedAt < (contacts[waId]?.changedAt ?? 0)) continue;
        contacts[waId] = entry.action === 'remove' ? { removed: true, changedAt }
          : { name: entry.contact.full_name ?? entry.contact.first_name ?? waId, changedAt };
      }
    });
  } else if (field === 'history') {
    for (const chunk of value.history ?? []) {
      for (const thread of chunk.threads ?? []) for (const message of thread.messages ?? []) await importMessage(thread.id, message, true);
      store.mutate(s => {
        s.whatsappOnboardingByTenant[tenantId] ??= { tenantId };
        const sync = s.whatsappOnboardingByTenant[tenantId].syncProgress ??= {};
        if (chunk.errors?.some(e => Number(e.code) === 2593109)) sync.history = 'not_shared';
        else if (chunk.errors?.length) { sync.history = 'error'; sync.errorCodes = chunk.errors.map(e => e.code); }
        else if (chunk.metadata) {
          sync.progress = Math.max(sync.progress ?? 0, Number(chunk.metadata.progress ?? 0));
          sync.history = sync.progress >= 100 ? 'completed' : 'importing';
        }
      });
    }
    // Media can precede its thread chunk; never infer a buyer from the store's sender number.
    for (const message of value.messages ?? []) {
      if (!message.id) continue;
      const existing = state.conversations.find(c => c.tenantId === tenantId && c.messages?.some(m => m.providerMessageId === message.id));
      if (existing) await importMessage(existing.waId, message, true);
      else store.mutate(s => {
        s.whatsappOnboardingByTenant[tenantId] ??= { tenantId };
        (s.whatsappOnboardingByTenant[tenantId].pendingHistoryMedia ??= {})[message.id] = message;
      });
    }
  } else if (field === 'smb_message_echoes') {
    for (const message of value.message_echoes ?? []) await importMessage(message.to, message, false);
  }
  // PostgreSQL checkpoints this tenant and its imported conversations directly.
  // Waiting for the full snapshot here stalls the shared inbound worker, so
  // customer messages cannot run until all unrelated mirror tables are saved.
  if (store.persistWhatsAppOnboarding) await store.persistWhatsAppOnboarding(tenantId);
  else await store.flush?.();
  return { duplicate: false, result: { summary: `WhatsApp ${field} imported without agent execution` } };

  async function importMessage(waId, message, historical) {
    if (!waId || !message.id) return;
    const pendingMedia = state.whatsappOnboardingByTenant[tenantId]?.pendingHistoryMedia?.[message.id];
    if (historical && pendingMedia && message.type === 'media_placeholder') message = { ...message, ...pendingMedia };
    let conversation = state.conversations.find(c => c.tenantId === tenantId && c.messages?.some(m => m.providerMessageId === message.id));
    if (!conversation) conversation = historical
      ? state.conversations.find(c => c.tenantId === tenantId && c.waId === waId && c.closeReason === 'imported_history')
      : state.conversations.find(c => c.tenantId === tenantId && c.waId === waId && !isClosedConversation(c));
    if (!conversation && !historical) conversation = await runtime.ensureConversation(tenantId, { waId, text: '', profileName: contactName(waId) });
    if (!conversation) {
      conversation = { id: `history-${crypto.randomUUID()}`, tenantId, waId, customer: contactName(waId),
        avatar: 'WA', status: 'completed', caseStatus: 'completed', inboxState: 'closed', closeReason: 'imported_history',
        closedAt: now, stage: 'history', zone: 'whatsapp', progress: 100, value: 'Historial', need: 'Historial importado de WhatsApp',
        nextStep: 'Consulta del historial; no genera pedidos.', messages: [], createdAt: now, updatedAt: now };
      store.mutate(s => s.conversations.push(conversation));
    }
    const duplicate = conversation.messages.find(m => m.providerMessageId === message.id);
    const time = Number(message.timestamp) * 1000;
    const imported = { id: duplicate?.id ?? crypto.randomUUID(), providerMessageId: message.id,
      role: !historical || message.from !== conversation.waId ? 'human' : 'user',
      text: (message.type === 'text' ? message.text?.body : message[message.type]?.caption) ?? `[${message.type}]`,
      messageType: message.type, mediaRef: message[message.type]?.id ?? null, historical,
      createdAt: Number.isFinite(time) ? new Date(time).toISOString() : now };
    store.mutate(() => {
      if (historical && pendingMedia) delete state.whatsappOnboardingByTenant[tenantId].pendingHistoryMedia[message.id];
      if (duplicate) {
        if (duplicate.messageType === 'media_placeholder' && message.type !== 'media_placeholder') Object.assign(duplicate, imported);
      } else conversation.messages.push(imported);
      conversation.messages.sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      conversation.updatedAt = now;
      if (!historical && !duplicate) conversation.manualLastActivityAt = now;
    });
    await store.persistConversation?.(conversation.id);
    if (!historical && !isClosedConversation(conversation) && conversation.manualMode !== 'whatsapp_external') await runtime.activateManualWhatsApp(conversation.id, { actorId: 'whatsapp_business_app' });
  }
  function contactName(waId) { return state.whatsappOnboardingByTenant[tenantId]?.contacts?.[waId]?.name ?? waId; }
}
