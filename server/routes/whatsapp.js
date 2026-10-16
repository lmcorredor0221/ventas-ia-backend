import crypto from 'node:crypto';
import express from 'express';
import { recordWebhookEvent } from '../services/platformService.js';

export function createWhatsAppRouter({ store, runtime, controlPlane }) {
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
      controlPlane?.requireTenantOperational(normalized.tenantId);
      const result = await runtime.processInbound(normalized);
      recordWebhookEvent(store, webhookRecordFromRequest(req, {
        tenantId: normalized.tenantId,
        eventType: normalized.messageType,
        externalId: normalized.messageId,
        status: result.duplicate ? 'duplicate' : 'processed',
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        conversationId: result.conversation?.id,
        metadata: { duplicate: result.duplicate, phoneNumberId: normalized.phoneNumberId, waId: normalized.waId },
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
        metadata: { phoneNumberId: extractPhoneNumberId(req.body) },
      }));
      next(error);
    }
  });

  return router;
}

function webhookRecordFromRequest(req, patch = {}) {
  return {
    provider: 'meta_whatsapp_cloud_api',
    tenantId: patch.tenantId ?? null,
    eventType: patch.eventType ?? 'message',
    externalId: patch.externalId ?? extractWhatsAppExternalId(req.body),
    idempotencyKey: patch.externalId ?? extractWhatsAppExternalId(req.body),
    headers: req.headers,
    payload: req.body ?? req.query ?? {},
    ...patch,
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
      tenantId: tenant.id,
      workspaceId: tenant.id,
      waId: status.recipient_id,
      phoneNumberId,
      messageId: status.id,
      timestamp: Number(status.timestamp ?? Date.now() / 1000) * 1000,
      messageType: 'delivery_status',
      text: status.status,
      mediaRef: null,
      rawPayloadRef: `raw:${status.id}`,
    };
  }

  if (!message) return null;
  const type = message.type;
  return {
    provider: 'meta_whatsapp_cloud_api',
    tenantId: tenant.id,
    workspaceId: tenant.id,
    waId: message.from,
    profileName: change?.contacts?.[0]?.profile?.name,
    phoneNumberId,
    messageId: message.id,
    timestamp: Number(message.timestamp ?? Date.now() / 1000) * 1000,
    messageType: type,
    text: type === 'text' ? message.text?.body : message[type]?.caption ?? '',
    mediaRef: type === 'image' ? message.image?.id : null,
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
  const tenant = state.tenants.find((item) => item.config?.whatsapp?.phoneNumberId === phoneNumberId);
  if (!tenant) {
    const error = new Error('WhatsApp phone_number_id is not bound to an active tenant');
    error.statusCode = 404;
    error.code = 'whatsapp_tenant_not_found';
    throw error;
  }
  return tenant;
}
