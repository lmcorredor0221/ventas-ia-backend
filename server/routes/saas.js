import express from 'express';

export function createSaasRouter({ controlPlane, auth }) {
  const router = express.Router();

  router.post('/tenants', (req, res, next) => {
    try {
      if (auth.config.authRequired) auth.requireSession(req);
      const bundle = controlPlane.createTenant(req.body ?? {}, { actor: req.auth?.user });
      if (req.auth?.user) {
        auth.attachTenantOwner({
          tenantId: bundle.tenant.id,
          userId: req.auth.user.id,
          ownerEmail: req.auth.user.email,
          ownerName: req.auth.user.name,
        });
      }
      res.status(201).json(controlPlane.getTenantBundle(bundle.tenant.id));
    } catch (error) {
      next(error);
    }
  });

  router.get('/tenants/:tenantId/status', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId);
      res.json(controlPlane.getTenantBundle(req.params.tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/subscription/checkout', async (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = await controlPlane.createSubscriptionCheckout({
        tenantId: req.params.tenantId,
        payerEmail: req.body?.payerEmail,
      });
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'subscription.checkout.requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/subscription/continue-checkout', async (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = await controlPlane.continueSubscriptionCheckout({
        tenantId: req.params.tenantId,
        payerEmail: req.body?.payerEmail,
      });
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'subscription.checkout.continue_requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/subscription/mock-activate', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.mockActivateSubscription(req.params.tenantId);
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'subscription.mock_activate.requested', resource: 'subscription' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/tenants/:tenantId/google/oauth/start', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.beginGoogleOAuth(req.params.tenantId, { loginHint: req.query.loginHint });
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'google.oauth.start.requested', resource: 'google_connection' });
      if (req.query.redirect === '1' && result.ready) return res.redirect(result.authorizationUrl);
      return res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/google/oauth/callback', async (req, res, next) => {
    try {
      const result = await controlPlane.completeGoogleOAuth({
        state: req.query.state,
        code: req.query.code,
        mockAccountEmail: req.query.mockAccountEmail,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/google/provision', async (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = await controlPlane.provisionGoogleWorkspace(req.params.tenantId);
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'google.workspace.provision.requested', resource: 'google_workspace' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/tenants/:tenantId/whatsapp/status', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId);
      res.json(controlPlane.getWhatsAppOnboarding(req.params.tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/whatsapp/intent', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.saveWhatsAppOnboardingIntent(req.params.tenantId, req.body ?? {});
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'whatsapp.onboarding.intent.requested', resource: 'whatsapp_connection' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/whatsapp/embedded-signup/start', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.startWhatsAppEmbeddedSignup(req.params.tenantId);
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'whatsapp.embedded_signup.requested', resource: 'whatsapp_connection' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/whatsapp/binding', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.saveWhatsAppBinding(req.params.tenantId, req.body ?? {});
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'whatsapp.binding.requested', resource: 'whatsapp_connection' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/validate', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.validateTenantSetup(req.params.tenantId);
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'tenant.validation.requested', resource: 'tenant_validation' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/activate', (req, res, next) => {
    try {
      auth.authorizeTenant(req, req.params.tenantId, { roles: ['owner'] });
      const result = controlPlane.activateTenant(req.params.tenantId);
      auth.recordTenantAction(req, { tenantId: req.params.tenantId, action: 'tenant.activation.requested', resource: 'tenant' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
