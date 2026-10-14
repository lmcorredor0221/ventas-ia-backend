import crypto from 'node:crypto';

const OWNER_ACTIONS = new Set(['tenant.create', 'tenant.config.update', 'billing.manage', 'integration.manage']);
const TENANT_ROLES = new Set(['owner', 'operator', 'viewer']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PATHS = new Set(['/api/auth/google']);

export class AuthService {
  constructor({ store, events, config }) {
    this.store = store;
    this.events = events;
    this.config = config;
  }

  middleware() {
    return async (req, _res, next) => {
      try {
        req.auth = await this.authenticateRequest(req);
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  csrfMiddleware() {
    return (req, _res, next) => {
      try {
        this.requireCsrf(req);
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  async loginWithGoogle({ idToken, profile = {} }) {
    const googleProfile = await this.verifyGoogleIdentity({ idToken, profile });
    const now = new Date().toISOString();
    let user;
    let memberships = [];
    let session;

    this.store.mutate((state) => {
      ensureIdentityState(state);
      user = upsertUserFromGoogle(state, googleProfile, now);
      autoLinkOwnedTenants(state, user, now);
      memberships = membershipsForUser(state, user.id);
      session = {
        id: `sess-${crypto.randomBytes(24).toString('hex')}`,
        userId: user.id,
        csrfToken: crypto.randomBytes(32).toString('hex'),
        createdAt: now,
        expiresAt: new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000).toISOString(),
        revokedAt: null,
        userAgentHash: hashValue(profile.userAgent ?? ''),
      };
      state.sessionsById[session.id] = session;
      pushAuditEvent(state, {
        actorId: user.id,
        action: 'auth.login',
        resource: 'session',
        metadata: { provider: 'google', mode: googleProfile.mode },
      });
    });

    this.events.emit({
      type: 'auth.login',
      tenantId: memberships[0]?.tenantId,
      detail: `Google login: ${user.email}`,
      metadata: { userId: user.id, mode: googleProfile.mode },
    });

    const exposedUser = publicUser(user);
    return {
      user: exposedUser,
      isPlatformAdmin: isPlatformAdmin(exposedUser, this.store.getState()),
      memberships,
      session,
      cookie: this.sessionCookie(session.id, session.expiresAt),
    };
  }

  requireCsrf(req) {
    if (!this.config.csrfRequired) return;
    if (!UNSAFE_METHODS.has(req.method)) return;
    if (CSRF_EXEMPT_PATHS.has(req.path)) return;
    if (!req.auth?.session) return;
    const provided = req.headers['x-csrf-token'];
    if (provided && safeEqual(String(provided), String(req.auth.session.csrfToken ?? ''))) return;
    const error = new Error('CSRF token required');
    error.statusCode = 403;
    error.code = 'csrf_required';
    throw error;
  }

  logout(req) {
    const sessionId = this.sessionIdFromRequest(req);
    if (!sessionId) return { loggedOut: true, cookie: this.clearSessionCookie() };
    this.store.mutate((state) => {
      ensureIdentityState(state);
      const session = state.sessionsById[sessionId];
      if (session) {
        session.revokedAt = new Date().toISOString();
        session.updatedAt = session.revokedAt;
        pushAuditEvent(state, {
          actorId: session.userId,
          action: 'auth.logout',
          resource: 'session',
          metadata: { sessionId },
        });
      }
    });
    return { loggedOut: true, cookie: this.clearSessionCookie() };
  }

  async authenticateRequest(req) {
    const sessionId = this.sessionIdFromRequest(req);
    if (!sessionId) return null;
    const state = this.store.getState();
    ensureIdentityState(state);
    const session = state.sessionsById[sessionId];
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return null;
    session.csrfToken ??= crypto.randomBytes(32).toString('hex');
    const user = state.users.find((item) => item.id === session.userId);
    if (!user) return null;
    const exposedUser = publicUser(user);
    return {
      session,
      user: exposedUser,
      isPlatformAdmin: isPlatformAdmin(exposedUser, state),
      memberships: membershipsForUser(state, user.id),
    };
  }

  requireSession(req) {
    if (req.auth?.user) return req.auth;
    const error = new Error('Authentication required');
    error.statusCode = 401;
    error.code = 'auth_required';
    throw error;
  }

  requirePlatformAdmin(req) {
    if (!this.config.authRequired && !req.auth?.user) return null;
    const auth = this.requireSession(req);
    if (isPlatformAdmin(auth.user, this.store.getState())) return auth;
    const error = new Error('Platform admin access denied');
    error.statusCode = 403;
    error.code = 'platform_admin_denied';
    throw error;
  }

  authorizeTenant(req, tenantId, { roles = [] } = {}) {
    if (!tenantId) return null;
    if (!this.config.authRequired && !req.auth?.user) return null;
    const auth = this.requireSession(req);
    const membership = auth.memberships.find((item) => item.tenantId === tenantId && item.status === 'active');
    if (!membership) {
      const error = new Error('Tenant access denied');
      error.statusCode = 403;
      error.code = 'tenant_access_denied';
      throw error;
    }
    if (roles.length && !roles.includes(membership.role)) {
      const error = new Error('Tenant role denied');
      error.statusCode = 403;
      error.code = 'tenant_role_denied';
      throw error;
    }
    return membership;
  }

  filterTenantsForRequest(req, tenants) {
    if (!this.config.authRequired && !req.auth?.user) return tenants;
    const auth = this.requireSession(req);
    const allowed = new Set(auth.memberships.filter((item) => item.status === 'active').map((item) => item.tenantId));
    return tenants.filter((tenant) => allowed.has(tenant.id));
  }

  tenantIdsForRequest(req) {
    if (!this.config.authRequired && !req.auth?.user) return null;
    const auth = this.requireSession(req);
    return auth.memberships.filter((item) => item.status === 'active').map((item) => item.tenantId);
  }

  attachTenantOwner({ tenantId, userId, ownerEmail, ownerName }) {
    this.store.mutate((state) => {
      ensureIdentityState(state);
      let user = userId ? state.users.find((item) => item.id === userId) : null;
      if (!user && ownerEmail) {
        user = upsertUserFromGoogle(state, {
          sub: `email:${ownerEmail.toLowerCase()}`,
          email: ownerEmail,
          name: ownerName || ownerEmail,
          mode: 'email_owner_seed',
        }, new Date().toISOString());
      }
      if (!user) return;
      upsertTenantMember(state, {
        tenantId,
        userId: user.id,
        role: 'owner',
        status: 'active',
      });
      pushAuditEvent(state, {
        tenantId,
        actorId: user.id,
        action: 'tenant.member.owner_attached',
        resource: 'tenant_member',
        metadata: { ownerEmail },
      });
    });
  }

  recordTenantAction(req, { tenantId, action, resource, metadata = {} }) {
    if (!req.auth?.user) return;
    this.store.mutate((state) => {
      ensureIdentityState(state);
      pushAuditEvent(state, {
        tenantId,
        actorId: req.auth.user.id,
        action,
        resource,
        metadata,
      });
    });
  }

  sessionCookie(sessionId, expiresAt) {
    const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    return cookieString(this.config.sessionCookieName, sessionId, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  clearSessionCookie() {
    return cookieString(this.config.sessionCookieName, '', {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  sessionIdFromRequest(req) {
    const cookies = parseCookieHeader(req.headers.cookie ?? '');
    const cookieSession = cookies[this.config.sessionCookieName];
    if (cookieSession) return cookieSession;
    const authHeader = req.headers.authorization ?? '';
    if (authHeader.toLowerCase().startsWith('bearer sess-')) return authHeader.slice('bearer '.length);
    return null;
  }

  async verifyGoogleIdentity({ idToken, profile }) {
    if (idToken === 'dev-google-id-token' && !this.config.allowDevGoogleLogin) {
      const error = new Error('Development Google login is disabled');
      error.statusCode = 401;
      error.code = 'dev_google_login_disabled';
      throw error;
    }
    if (process.env.GOOGLE_CLIENT_ID && idToken && idToken !== 'dev-google-id-token') {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.aud !== process.env.GOOGLE_CLIENT_ID) {
        const error = new Error('Invalid Google ID token');
        error.statusCode = 401;
        error.code = 'invalid_google_id_token';
        throw error;
      }
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture,
        emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
        mode: 'live',
      };
    }
    if (!profile?.email || !profile?.sub) {
      const error = new Error('profile.email and profile.sub are required in sandbox Google login');
      error.statusCode = 400;
      throw error;
    }
    return {
      sub: profile.sub,
      email: profile.email,
      name: profile.name ?? profile.email,
      picture: profile.picture,
      emailVerified: true,
      mode: 'sandbox_contract',
    };
  }
}

export function ensureIdentityState(state) {
  state.users ??= [];
  state.tenantMembers ??= [];
  state.sessionsById ??= {};
  state.auditEvents ??= [];
  for (const tenant of state.tenants ?? []) {
    const ownerEmail = tenant.lifecycle?.ownerEmail ?? state.subscriptionsByTenant?.[tenant.id]?.payerEmail;
    if (!ownerEmail) continue;
    const user = upsertUserFromGoogle(state, {
      sub: `email:${ownerEmail.toLowerCase()}`,
      email: ownerEmail,
      name: tenant.lifecycle?.ownerName ?? ownerEmail,
      mode: 'seed_owner',
    }, tenant.lifecycle?.createdAt ?? new Date().toISOString());
    upsertTenantMember(state, { tenantId: tenant.id, userId: user.id, role: 'owner', status: 'active' });
  }
}

function upsertUserFromGoogle(state, profile, now) {
  const email = String(profile.email ?? '').toLowerCase();
  const googleSubject = String(profile.sub);
  let user = state.users.find((item) => item.googleSubject === googleSubject || item.email.toLowerCase() === email);
  if (!user) {
    user = {
      id: `usr-${crypto.randomUUID()}`,
      googleSubject,
      email,
      name: profile.name ?? email,
      pictureUrl: profile.picture ?? null,
      createdAt: now,
      updatedAt: now,
    };
    state.users.push(user);
    return user;
  }
  user.googleSubject = user.googleSubject ?? googleSubject;
  user.email = email;
  user.name = profile.name ?? user.name;
  user.pictureUrl = profile.picture ?? user.pictureUrl ?? null;
  user.updatedAt = now;
  return user;
}

function autoLinkOwnedTenants(state, user, now) {
  const email = user.email.toLowerCase();
  for (const tenant of state.tenants ?? []) {
    const ownerEmail = String(tenant.lifecycle?.ownerEmail ?? state.subscriptionsByTenant?.[tenant.id]?.payerEmail ?? '').toLowerCase();
    if (ownerEmail !== email) continue;
    upsertTenantMember(state, { tenantId: tenant.id, userId: user.id, role: 'owner', status: 'active', createdAt: now });
  }
}

function upsertTenantMember(state, member) {
  if (!TENANT_ROLES.has(member.role)) throw new Error(`Invalid tenant role: ${member.role}`);
  const existing = state.tenantMembers.find((item) => item.tenantId === member.tenantId && item.userId === member.userId);
  const now = new Date().toISOString();
  if (existing) {
    existing.role = member.role;
    existing.status = member.status ?? existing.status;
    existing.updatedAt = now;
    return existing;
  }
  const next = {
    tenantId: member.tenantId,
    userId: member.userId,
    role: member.role,
    status: member.status ?? 'active',
    createdAt: member.createdAt ?? now,
    updatedAt: now,
  };
  state.tenantMembers.push(next);
  return next;
}

function membershipsForUser(state, userId) {
  return (state.tenantMembers ?? [])
    .filter((item) => item.userId === userId)
    .map((item) => {
      const tenant = state.tenants.find((tenantItem) => tenantItem.id === item.tenantId);
      return {
        tenantId: item.tenantId,
        tenantName: tenant?.name,
        role: item.role,
        status: item.status,
      };
    });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    pictureUrl: user.pictureUrl,
    platformRole: user.platformRole ?? null,
  };
}

function isPlatformAdmin(user, state) {
  const email = String(user?.email ?? '').toLowerCase();
  const envAdmins = String(process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (envAdmins.includes(email)) return true;
  const persisted = state.users?.find((item) => item.id === user?.id || item.email?.toLowerCase() === email);
  return persisted?.platformRole === 'platform_admin';
}

function pushAuditEvent(state, event) {
  return appendAuditEvent(state, event);
}

export function appendAuditEvent(state, event) {
  const record = {
    id: `aud-${crypto.randomUUID()}`,
    tenantId: event.tenantId ?? null,
    actorId: event.actorId ?? null,
    action: event.action,
    resource: event.resource ?? null,
    metadata: event.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  state.auditEvents.unshift(record);
  state.auditEvents = state.auditEvents.slice(0, 1000);
  return record;
}

function parseCookieHeader(value) {
  return String(value)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index < 0) return cookies;
      cookies[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function cookieString(name, value, options) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function hashValue(value) {
  return value ? crypto.createHash('sha256').update(value).digest('hex') : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isOwnerAction(action) {
  return OWNER_ACTIONS.has(action);
}
