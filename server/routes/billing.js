import express from 'express';

export function createBillingRouter({ controlPlane, auth }) {
  const router = express.Router();

  router.get('/plans', (_req, res, next) => {
    try {
      res.json({ plans: controlPlane.listBillingPlans() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', (req, res, next) => {
    try {
      const tenantId = String(req.query.tenantId ?? '');
      auth.authorizeTenant(req, tenantId);
      res.json(controlPlane.getBillingStatus(tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/checkout', async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId ?? '');
      auth.authorizeTenant(req, tenantId, { roles: ['owner'] });
      const result = await controlPlane.createSubscriptionCheckout({
        tenantId,
        payerEmail: req.body?.payerEmail,
      });
      auth.recordTenantAction(req, { tenantId, action: 'billing.checkout.requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/continue-checkout', async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId ?? '');
      auth.authorizeTenant(req, tenantId, { roles: ['owner'] });
      const result = await controlPlane.continueSubscriptionCheckout({
        tenantId,
        payerEmail: req.body?.payerEmail,
      });
      auth.recordTenantAction(req, { tenantId, action: 'billing.checkout.continue_requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/cancel', (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId ?? '');
      auth.authorizeTenant(req, tenantId, { roles: ['owner'] });
      const result = controlPlane.cancelSubscription(tenantId, req.body ?? {}, { actor: req.auth?.user });
      auth.recordTenantAction(req, { tenantId, action: 'billing.cancel.requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/change-plan', (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId ?? '');
      auth.authorizeTenant(req, tenantId, { roles: ['owner'] });
      const result = controlPlane.changeSubscriptionPlan(tenantId, req.body ?? {}, { actor: req.auth?.user });
      auth.recordTenantAction(req, { tenantId, action: 'billing.plan_change.requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/payments', (req, res, next) => {
    try {
      const tenantId = String(req.query.tenantId ?? '');
      auth.authorizeTenant(req, tenantId);
      res.json({ payments: controlPlane.getPaymentHistory(tenantId) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
