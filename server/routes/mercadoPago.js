import express from 'express';
import { recordWebhookEvent } from '../services/platformService.js';

export function createMercadoPagoRouter({ controlPlane, store }) {
  const router = express.Router();

  router.post('/mercadopago', async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const result = await controlPlane.handleMercadoPagoWebhook({
        payload: req.body ?? {},
        headers: req.headers,
        query: req.query,
      });
      recordWebhookEvent(store, {
        provider: 'mercado_pago',
        tenantId: result.subscription?.tenantId ?? req.body?.external_reference ?? null,
        eventType: req.body?.type ?? req.body?.topic ?? req.query?.type ?? 'subscription',
        externalId: req.body?.data?.id ?? req.query?.['data.id'] ?? req.query?.data_id ?? result.dataId ?? null,
        status: result.ignored ? 'ignored' : 'processed',
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        headers: req.headers,
        payload: req.body ?? {},
        metadata: { topic: result.topic, accepted: result.accepted, ignored: result.ignored },
      });
      res.status(200).json(result);
    } catch (error) {
      recordWebhookEvent(store, {
        provider: 'mercado_pago',
        tenantId: req.body?.external_reference ?? null,
        eventType: req.body?.type ?? req.body?.topic ?? req.query?.type ?? 'subscription',
        externalId: req.body?.data?.id ?? req.query?.['data.id'] ?? req.query?.data_id ?? null,
        status: error.statusCode && error.statusCode < 500 ? 'rejected' : 'failed',
        httpStatus: error.statusCode ?? 500,
        durationMs: Date.now() - startedAt,
        headers: req.headers,
        payload: req.body ?? {},
        errorCode: error.code ?? 'mercadopago_webhook_error',
        errorMessage: error.message,
      });
      next(error);
    }
  });

  return router;
}
