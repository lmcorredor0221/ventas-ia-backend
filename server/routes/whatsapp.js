import crypto from 'node:crypto';
import express from 'express';

export function createWhatsAppRouter({ store, runtime }) {
  const router = express.Router();

  router.get('/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'dev-verify-token';
    if (mode === 'subscribe' && token === expected) return res.status(200).send(challenge ?? '');
    return res.status(403).json({ error: 'Invalid webhook verification token' });
  });

  router.post('/whatsapp', async (req, res, next) => {
    try {
      if (!verifySignature(req)) return res.status(403).json({ error: 'Invalid WhatsApp signature' });
      const normalized = normalizeWhatsAppPayload(req.body, store.getState());
      if (!normalized) return res.status(400).json({ error: 'Malformed or unsupported WhatsApp payload' });
      const result = await runtime.processInbound(normalized);
      return res.status(200).json({ ok: true, duplicate: result.duplicate, conversationId: result.conversation?.id });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function verifySignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;
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
  const tenant = state.tenants.find((item) => item.config?.whatsapp?.phoneNumberId === phoneNumberId) ?? state.tenants[0];

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
