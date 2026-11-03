import crypto from 'node:crypto';

const attemptLocks = new WeakMap();
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const fault = (code, message, statusCode = 422) => Object.assign(new Error(message), { code, statusCode });

export function createWhatsAppSignupAttempt(control, tenantId, { purpose, setupPath, actorId }) {
  if (attemptLocks.get(control)?.has(tenantId)) throw fault('whatsapp_signup_busy', 'La conexión está terminando. Espera antes de iniciar otro intento.', 409);
  const attemptId = crypto.randomBytes(32).toString('base64url');
  return { attemptId, saved: { idHash: digest(attemptId), actorId: actorId ?? null, purpose, setupPath,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), status: 'pending' } };
}

export async function completeWhatsAppSignup(control, tenantId, payload, { actorId } = {}, fetchGraphJson) {
  control.requireTenant(tenantId);
  control.requireActiveSubscriptionForSetup(tenantId, 'whatsapp_embedded_signup');
  const readiness = control.getWhatsAppOnboarding(tenantId);
  if (!readiness.canAutomate) throw fault(readiness.reason, 'La conexión con Meta aún no está habilitada por Ventas IA.', 428);
  const attempt = control.store.getState().whatsappOnboardingByTenant[tenantId]?.attempt;
  if (!payload.attemptId || !attempt || attempt.idHash !== digest(payload.attemptId) || attempt.actorId !== (actorId ?? null)) {
    throw fault('whatsapp_signup_attempt_invalid', 'Este intento no corresponde a tu tienda o sesión. Abre Conectar con Meta de nuevo.', 409);
  }
  if (attempt.status === 'completed') return control.getTenantBundle(tenantId);
  if (Date.parse(attempt.expiresAt) <= Date.now()) throw fault('whatsapp_signup_attempt_expired', 'El intento venció. Abre Conectar con Meta de nuevo.', 409);
  let locks = attemptLocks.get(control);
  if (!locks) { locks = new Set(); attemptLocks.set(control, locks); }
  if (locks.has(tenantId)) throw fault('whatsapp_signup_busy', 'La conexión está terminando. Espera unos segundos.', 409);
  locks.add(tenantId);
  const persist = async () => { await control.store.persistWhatsAppOnboarding?.(tenantId); };
  const updateAttempt = async patch => {
    control.store.mutate(() => Object.assign(attempt, patch));
    await persist();
  };
  try {
    const tenant = control.requireTenant(tenantId);
    const appId = String(process.env.META_APP_ID ?? '');
    const appSecret = String(process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET ?? '');
    const graph = `https://graph.facebook.com/${control.config.whatsappGraphVersion}`;
    const code = String(payload.code ?? '').trim();
    let accessToken;
    if (attempt.tokenRef) {
      if (code && digest(code) !== attempt.codeHash) throw fault('whatsapp_signup_attempt_invalid', 'El código no corresponde a este intento.', 409);
      accessToken = control.secretVault.readSecret(attempt.tokenRef);
    } else {
      if (!code || !payload.wabaId) throw fault('whatsapp_embedded_signup_payload_incomplete', 'Meta debe autorizar una cuenta de WhatsApp para esta tienda.');
      if (!appId || !appSecret) throw fault('meta_embedded_signup_not_configured', 'La conexión de Meta no está configurada.', 428);
      const url = new URL(`${graph}/oauth/access_token`);
      url.searchParams.set('client_id', appId); url.searchParams.set('client_secret', appSecret); url.searchParams.set('code', code);
      const token = await fetchGraphJson(url, { method: 'GET' }, 'whatsapp_embedded_signup_token_exchange');
      accessToken = String(token.access_token ?? '');
      if (!accessToken) throw fault('whatsapp_embedded_signup_token_missing', 'Meta no devolvió acceso para esta tienda.', 502);
      const tokenRef = control.secretVault.saveSecret({ tenantId, name: `WHATSAPP_SIGNUP_${attempt.idHash.slice(0, 16)}`, value: accessToken,
        provider: 'meta_whatsapp_cloud_api', purpose: 'Autorización temporal de vinculación de la tienda' });
      const issuedAt = new Date().toISOString();
      const seconds = Number(token.expires_in);
      await updateAttempt({ tokenRef, codeHash: digest(code), wabaId: String(payload.wabaId),
        businessId: payload.businessId ? String(payload.businessId) : null,
        issuedAt, expiresAtProvider: Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null,
        tokenExpiryKnown: token.expires_in !== undefined && Number.isFinite(seconds),
        status: 'authorized' });
    }
    if (!accessToken) throw fault('whatsapp_signup_access_missing', 'Vuelve a autorizar tu tienda con Meta.', 409);
    if (payload.wabaId && String(payload.wabaId) !== attempt.wabaId) throw fault('whatsapp_signup_asset_mismatch', 'La cuenta no corresponde a la autorización recibida.');
    const headers = { authorization: `Bearer ${accessToken}` };
    const business = await fetchGraphJson(`${graph}/me?fields=client_business_id`, { headers }, 'whatsapp_business_validation');
    const businessId = String(business.client_business_id ?? '');
    if (!businessId || (attempt.businessId && attempt.businessId !== businessId)) throw fault('whatsapp_business_mismatch', 'No pudimos verificar el negocio autorizado. Selecciona el negocio de tu tienda en Meta.');
    const wabaId = attempt.wabaId;
    const pages = await fetchGraphJson(`${graph}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`, { headers }, 'whatsapp_waba_validation');
    // Follow a bounded number of cursors, never a provider-supplied next URL with a token in it.
    let phones = [...(pages.data ?? [])], page = pages;
    for (let i = 0; page.paging?.next && page.paging?.cursors?.after && i < 9; i++) {
      page = await fetchGraphJson(`${graph}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100&after=${encodeURIComponent(page.paging.cursors.after)}`, { headers }, 'whatsapp_waba_validation');
      phones.push(...(page.data ?? []));
    }
    const requested = String(payload.phoneNumberId ?? '').trim();
    if (!requested && (phones.length !== 1 || page.paging?.next)) {
      if (!phones.length) throw fault('whatsapp_phone_not_available', 'Esta cuenta todavía no tiene un número disponible. Completa el alta del número en Meta.');
      const choices = phones.map(p => ({ id: String(p.id), displayPhoneNumber: p.display_phone_number ?? null, verifiedName: p.verified_name ?? null }));
      await updateAttempt({ status: 'awaiting_phone_selection', phones: choices, businessId });
      return { requiresPhoneSelection: true, attemptId: payload.attemptId, phones: choices };
    }
    const phoneNumberId = requested || String(phones[0].id);
    if (!phones.some(p => String(p.id) === phoneNumberId)) throw fault('whatsapp_phone_not_in_waba', 'El número no pertenece a la cuenta de WhatsApp autorizada.');
    if (attempt.purpose === 'renew' && (tenant.config.whatsapp.phoneNumberId !== phoneNumberId || tenant.config.whatsapp.wabaId !== wabaId)) {
      throw fault('whatsapp_renewal_asset_mismatch', 'Para renovar, selecciona el mismo número y cuenta de WhatsApp que ya usa esta tienda.');
    }
    const other = control.store.getState().tenants.find(t => t.id !== tenantId && t.config?.whatsapp?.phoneNumberId === phoneNumberId);
    if (other) throw fault('whatsapp_phone_already_bound', 'Este número ya está vinculado a otra tienda de VIA.', 409);
    const phone = await fetchGraphJson(`${graph}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,is_on_biz_app,platform_type`, { headers }, 'whatsapp_phone_validation');
    if (String(phone.id ?? '') !== phoneNumberId) throw fault('whatsapp_phone_mismatch', 'Meta devolvió un número diferente.');
    const coexistence = attempt.setupPath === 'business_app_existing';
    if ((coexistence && (phone.is_on_biz_app !== true || phone.platform_type !== 'CLOUD_API')) || (!coexistence && phone.is_on_biz_app === true)) {
      throw fault('whatsapp_setup_path_mismatch', 'El número no corresponde a la opción elegida. Para conservar la app del celular, elige WhatsApp Business App y completa su vinculación en Meta.');
    }
    if (attempt.setupPath === 'cloud_api_existing' && phone.platform_type !== 'CLOUD_API') {
      throw fault('whatsapp_cloud_phone_required', 'Meta no confirmó que este número use Cloud API. Completa su incorporación en Meta antes de vincularlo.');
    }
    const register = attempt.setupPath === 'new_business' && attempt.purpose !== 'renew';
    if (register && !attempt.phoneRegistered && !/^\d{6}$/.test(String(payload.registrationPin ?? ''))) throw fault('whatsapp_registration_pin_required', 'Ingresa el PIN de seguridad de seis dígitos para registrar este número nuevo.');
    if (attempt.phoneNumberId && attempt.phoneNumberId !== phoneNumberId) throw fault('whatsapp_signup_asset_mismatch', 'El intento ya está terminando con otro número. Inicia uno nuevo.');
    // The DB claim survives process restarts and arbitrates competing tenants before provider mutations.
    await control.store.persistTenantCritical?.(tenantId);
    await control.store.claimWhatsAppPhone?.(tenantId, phoneNumberId);
    await updateAttempt({ phoneNumberId, businessId, status: 'finalizing', phones: null });
    if (!attempt.webhookSubscribed) {
      const subscribed = await fetchGraphJson(`${graph}/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', headers }, 'whatsapp_waba_webhook_subscription');
      if (subscribed.success !== true) throw fault('whatsapp_webhook_subscription_failed', 'Meta no confirmó la suscripción del canal.', 502);
      await updateAttempt({ webhookSubscribed: true });
    }
    if (register && !attempt.phoneRegistered) {
      const registered = await fetchGraphJson(`${graph}/${encodeURIComponent(phoneNumberId)}/register`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin: String(payload.registrationPin) }),
      }, 'whatsapp_phone_registration');
      if (registered.success !== true) throw fault('whatsapp_phone_registration_failed', 'Meta no confirmó el registro del número.', 502);
      await updateAttempt({ phoneRegistered: true });
    }
    const result = await control.saveWhatsAppBinding(tenantId, {
      phoneNumberId, wabaId, businessId, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name,
      accessTokenRef: attempt.tokenRef, accessTokenIssuedAt: attempt.issuedAt, accessTokenExpiresAt: attempt.expiresAtProvider,
      tokenExpiryKnown: attempt.tokenExpiryKnown, coexistence,
    }, { verifiedByProvider: true });
    const sync = coexistence && attempt.purpose !== 'renew'
      ? await syncCoexistence(control, tenantId, attempt, fetchGraphJson) : null;
    if (sync?.syncPending) return sync;
    await updateAttempt({ status: 'completed', completedAt: new Date().toISOString(), codeHash: null });
    control.audit(tenantId, 'whatsapp.embedded_signup.completed', 'whatsapp_connection', {
      wabaId, phoneNumberId, businessId, webhookSubscribed: true, phoneRegistered: register, renewalAttempt: attempt.purpose === 'renew',
    });
    return { ...result, whatsappOnboarding: control.getWhatsAppOnboarding(tenantId) };
  } finally { locks.delete(tenantId); }
}

async function syncCoexistence(control, tenantId, attempt, fetchGraphJson) {
  const config = control.requireTenant(tenantId).config.whatsapp;
  if (!config.coexistence || !attempt || attempt.phoneNumberId !== config.phoneNumberId) throw fault('whatsapp_sync_not_available', 'Esta conexión no tiene una sincronización inicial pendiente.');
  const persist = async patch => {
    control.store.mutate(() => Object.assign(attempt, patch));
    await control.store.persistWhatsAppOnboarding?.(tenantId);
  };
  const accessToken = control.secretVault.readSecret(config.accessTokenRef);
  for (const syncType of ['smb_app_state_sync', 'history']) {
    if (attempt.syncRequests?.[syncType]) continue;
    if (attempt.syncInFlight === syncType) throw fault('whatsapp_sync_outcome_unknown', 'No pudimos confirmar si Meta aceptó la sincronización. Revisa los eventos recibidos o solicita ayuda a Meta antes de repetir una operación que solo admite una solicitud.', 409);
    if (Date.now() - Date.parse(attempt.issuedAt) >= 24 * 60 * 60_000) throw fault('whatsapp_sync_window_expired', 'La ventana de 24 horas de Meta para importar datos terminó. El canal sigue vinculado; revisa la incorporación en Meta para solicitar una nueva importación.', 409);
    try {
      await persist({ syncInFlight: syncType });
      const sync = await fetchGraphJson('https://graph.facebook.com/' + control.config.whatsappGraphVersion + '/' + encodeURIComponent(config.phoneNumberId) + '/smb_app_data', {
        method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
      }, 'whatsapp_coexistence_sync');
      if (!sync.request_id) throw fault('whatsapp_coexistence_sync_failed', 'Meta no confirmó el inicio de sincronización.', 502);
      await persist({ syncRequests: { ...attempt.syncRequests, [syncType]: sync.request_id }, syncError: null, syncInFlight: null });
    } catch (error) {
      if (syncType === 'history' && Number(error.payload?.error?.code) === 2593109) {
        await persist({ syncRequests: { ...attempt.syncRequests, history: 'not_shared' }, syncError: null, syncInFlight: null });
        continue;
      }
      await persist({ syncError: error.payload ? error.code : 'whatsapp_sync_outcome_unknown', syncInFlight: error.payload ? null : syncType });
      control.audit(tenantId, 'whatsapp.coexistence.sync_failed', 'whatsapp_connection', { syncType, code: error.code ?? 'provider_error' });
      return { ...control.getTenantBundle(tenantId), syncPending: true };
    }
  }
  return control.getTenantBundle(tenantId);
}

export async function retryWhatsAppCoexistenceSync(control, tenantId, fetchGraphJson) {
  control.requireTenant(tenantId);
  let locks = attemptLocks.get(control);
  if (!locks) { locks = new Set(); attemptLocks.set(control, locks); }
  if (locks.has(tenantId)) throw fault('whatsapp_signup_busy', 'La conexión está terminando. Espera unos segundos.', 409);
  locks.add(tenantId);
  try {
    const attempt = control.store.getState().whatsappOnboardingByTenant[tenantId]?.attempt;
    const result = await syncCoexistence(control, tenantId, attempt, fetchGraphJson);
    if (!result.syncPending) {
      control.store.mutate(() => Object.assign(attempt, { status: 'completed', completedAt: new Date().toISOString(), codeHash: null }));
      await control.store.persistWhatsAppOnboarding?.(tenantId);
    }
    return result;
  } finally { locks.delete(tenantId); }
}
