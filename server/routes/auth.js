import express from 'express';

export function createAuthRouter({ auth }) {
  const router = express.Router();

  router.post('/google', async (req, res, next) => {
    try {
      const result = await auth.loginWithGoogle({
        idToken: req.body?.idToken,
        profile: {
          ...(req.body?.profile ?? {}),
          userAgent: req.headers['user-agent'] ?? '',
        },
      });
      res.setHeader('Set-Cookie', result.cookie);
      res.json({
        user: result.user,
        memberships: result.memberships,
        session: {
          expiresAt: result.session.expiresAt,
          csrfToken: result.session.csrfToken,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', (req, res, next) => {
    try {
      const authState = auth.requireSession(req);
      res.json({
        user: authState.user,
        memberships: authState.memberships,
        session: {
          expiresAt: authState.session.expiresAt,
          csrfToken: authState.session.csrfToken,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (req, res, next) => {
    try {
      const result = auth.logout(req);
      res.setHeader('Set-Cookie', result.cookie);
      res.json({ loggedOut: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
