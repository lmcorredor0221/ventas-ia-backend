import crypto from 'node:crypto';
import express from 'express';
import { recordWebhookEvent } from '../services/platformService.js';

export function createWhatsAppRouter({ store, runtime, controlPlane, config = {} }) {
  const router = express.Router();

  router.get('/whatsapp', (req, res) => {
    const startedAt = Date.now();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      ?? (process.env.NODE_ENV === 'production' ? null : 'dev-verify-token');
    const ok = Boolean(expected) && mode === 'subscribe' && token === expected;
    recordWebhookEvent(store, {
      provider: 'meta_whatsapp_cloud_api',
      eventType: 'verification',
      externalId: challenge ?? null,
      status: ok ? 'processed' : 'rejected',
      httpStatus: ok ? 200 : 403,
      durationMs: Date.now() - startedAt,
      headers: req.headers,
      payload: req.query,
      errorCode: ok ? null : 'invalid_verify_token',
      errorMessage: ok ? null : 'Invalid webhook verification token',
    });
    if (ok) return res.status(200).send(challenge ?? '');
    return res.status(403).json({ error: 'Invalid webhook verification token' });
  });

  router.post('/whatsapp', async (req, res, next) => {
    const startedAt = Date.now();
    let normalized = null;
    try {
      if (!verifySignature(req)) {
        recordWebhookEvent(store, webhookRecordFromRequest(req, {
          status: 'rejected',
          httpStatus: 403,
          durationMs: Date.now() - startedAt,
          errorCode: 'invalid_signature',
          errorMessage: 'Invalid WhatsApp signature',
        }));
        return res.status(403).json({ error: 'Invalid WhatsApp signature' });
      }
      normalized = normalizeWhatsAppPayload(req.body, store.getState());
      if (!normalized) {
        recordWebhookEvent(store, webhookRecordFromRequest(req, {
          status: 'ignored',
          httpStatus: 400,
          durationMs: Date.now() - startedAt,
          errorCode: 'malformed_payload',
          errorMessage: 'Malformed or unsupported WhatsApp payload',
        }));
        return res.status(400).json({ error: 'Malformed or unsupported WhatsApp payload' });
      }
      if (!normalized.tenantId) {
        recordWebhookEvent(store, webhookRecordFromRequest(req, {
          status: 'ignored',
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          eventType: normalized.messageType,
          externalId: normalized.messageId,
          errorCode: 'whatsapp_tenant_not_found',
          errorMessage: 'WhatsApp event does not belong to a connected tenant',
          metadata: {
            phoneNumberId: normalized.phoneNumberId,
            waId: normalized.waId,
            traceId: normalized.traceId,
            requestId: req.requestId,
          },
        }));
        return res.status(200).json({ ok: true, ignored: true, reason: 'whatsapp_tenant_not_found' });
      }
      controlPlane?.requireTenantOperational(normalized.tenantId);
      if (normalized.messageType === 'delivery_status') {
        recordWebhookEvent(store, webhookRecordFromRequest(req, {
          tenantId: normalized.tenantId,
          eventType: normalized.messageType,
          externalId: normalized.messageId,
          status: 'ignored',
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          metadata: { phoneNumberId: normalized.phoneNumberId, waId: normalized.waId, traceId: normalized.traceId, requestId: req.requestId },
        }));
        return res.status(200).json({ ok: true, ignored: true, reason: 'delivery_status' });
      }
      if (config.asyncInboundEnabled) {
        const queued = await store.enqueueInboundMessage(normalized);
        recordWebhookEvent(store, webhookRecordFromRequest(req, {
          tenantId: normalized.tenantId,
          eventType: normalized.messageType,
          externalId: normalized.messageId,
          status: queued.created ? 'queued' : 'duplicate',
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          metadata: {
            duplicate: !queued.created,
            queue: 'whatsapp.inbound_processing',
            phoneNumberId: normalized.phoneNumberId,
            waId: normalized.waId,
            traceId: normalized.traceId,
            requestId: req.requestId,
          },
        }));
        return res.status(200).json({ ok: true, queued: queued.created, duplicate: !queued.created });
      }
      const result = await runtime.processInbound(normalized);
      recordWebhookEvent(store, webhookRecordFromRequest(req, {
        tenantId: normalized.tenantId,
        eventType: normalized.messageType,
        externalId: normalized.messageId,
        status: result.duplicate ? 'duplicate' : 'processed',
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        conversationId: result.conversation?.id,
        metadata: { duplicate: result.duplicate, phoneNumberId: normalized.phoneNumberId, waId: normalized.waId, traceId: normalized.traceId, requestId: req.requestId },
      }));
      return res.status(200).json({ ok: true, duplicate: result.duplicate, conversationId: result.conversation?.id });
    } catch (error) {
      recordWebhookEvent(store, webhookRecordFromRequest(req, {
        tenantId: normalized?.tenantId,
        eventType: normalized?.messageType ?? 'message',
        externalId: normalized?.messageId ?? extractWhatsAppExternalId(req.body),
        status: error.statusCode && error.statusCode < 500 ? 'rejected' : 'failed',
        httpStatus: error.statusCode ?? 500,
        durationMs: Date.now() - startedAt,
        errorCode: error.code ?? 'webhook_processing_error',
        errorMessage: error.message,
        metadata: { phoneNumberId: extractPhoneNumberId(req.body), traceId: normalized?.traceId ?? null, requestId: req.requestId },
      }));
      next(error);
    }
  });

  return router;
}

function webhookRecordFromRequest(req, patch = {}) {
  const externalId = patch.externalId ?? extractWhatsAppExternalId(req.body);
  return {
    provider: 'meta_whatsapp_cloud_api',
    tenantId: patch.tenantId ?? null,
    eventType: patch.eventType ?? 'message',
    externalId,
    idempotencyKey: patch.idempotencyKey ?? externalId,
    headers: req.headers,
    payload: req.body ?? req.query ?? {},
    ...patch,
    metadata: { traceId: patch.traceId ?? externalId, ...(patch.metadata ?? {}) },
  };
}

function extractWhatsAppExternalId(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  return value?.messages?.[0]?.id ?? value?.statuses?.[0]?.id ?? null;
}

function extractPhoneNumberId(payload) {
  return payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
}

function verifySignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET;
  if (!appSecret) return process.env.NODE_ENV !== 'production';
  const signature = req.get('X-Hub-Signature-256');
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody ?? '').digest('hex')}`;
  return safeEqual(signature, expected);
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeWhatsAppPayload(payload, state) {
  const change = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  const status = change?.statuses?.[0];
  const metadata = change?.metadata;
  const phoneNumberId = metadata?.phone_number_id;
  const tenant = resolveTenantByPhoneNumberId(state, phoneNumberId);

  if (status) {
    return {
      provider: 'meta_whatsapp_cloud_api',
      tenantId: tenant?.id ?? null,
      workspaceId: tenant?.id ?? null,
      waId: status.recipient_id,
      phoneNumberId,
      messageId: status.id,
      traceId: `wa:${status.id}`,
      timestamp: Number(status.timestamp ?? Date.now() / 1000) * 1000,
      messageType: 'delivery_status',
      text: status.status,
      mediaRef: null,
      rawPayloadRef: `raw:${status.id}`,
    };
  }

  if (!message) return null;
  const type = message.type;
  const interactive = type === 'interactive' ? message.interactive : null;
  const interactionReply = interactive?.button_reply ?? interactive?.list_reply ?? null;
  return {
    provider: 'meta_whatsapp_cloud_api',
    tenantId: tenant?.id ?? null,
    workspaceId: tenant?.id ?? null,
    waId: message.from,
    profileName: change?.contacts?.[0]?.profile?.name,
    phoneNumberId,
    messageId: message.id,
    traceId: `wa:${message.id}`,
    timestamp: Number(message.timestamp ?? Date.now() / 1000) * 1000,
    messageType: type,
    text: type === 'text'
      ? message.text?.body
      : interactionReply?.title ?? message[type]?.caption ?? '',
    mediaRef: type === 'image' ? message.image?.id : null,
    interactive: interactionReply ? {
      type: interactive.type,
      optionId: interactionReply.id,
      title: interactionReply.title ?? '',
      description: interactionReply.description ?? '',
    } : null,
    rawPayloadRef: `raw:${message.id}`,
  };
}

function resolveTenantByPhoneNumberId(state, phoneNumberId) {
  if (!phoneNumberId) {
    const error = new Error('WhatsApp phone_number_id is required');
    error.statusCode = 400;
    error.code = 'whatsapp_phone_number_missing';
    throw error;
  }
  return state.tenants.find((item) => item.config?.whatsapp?.phoneNumberId === phoneNumberId) ?? null;
}
