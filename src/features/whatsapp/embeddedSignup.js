function isTrustedMetaOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'facebook.com'
      || host.endsWith('.facebook.com')
      || host === 'meta.com'
      || host.endsWith('.meta.com');
  } catch {
    return false;
  }
}

export async function launchMetaEmbeddedSignup(launch, FB, window) {
  if (!launch?.appId || !launch?.configId) throw new Error('Falta la configuración de Meta Embedded Signup.');
  return new Promise((resolve, reject) => {
    let loginCode = '';
    let sessionInfo = null;
    let settled = false;
    let timer;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
    const finish = () => {
      if (settled || !loginCode || !sessionInfo?.wabaId) return;
      settled = true;
      cleanup();
      resolve({ code: loginCode, ...sessionInfo, attemptId: launch.attemptId });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onMessage = (event) => {
      if (!isTrustedMetaOrigin(event.origin)) return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const payload = data.data ?? data;
      const eventName = String(data.event ?? payload.event ?? '').toUpperCase();
      if (eventName === 'CANCEL' || eventName === 'ERROR') {
        fail(new Error('La autorización de WhatsApp fue cancelada o reportó un error.'));
        return;
      }
      if (!['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH_GRANT_ONLY_API_ACCESS'].includes(eventName)) return;
      if (!(payload.waba_id ?? payload.wabaId)) {
        fail(new Error('Meta no devolvió una cuenta de WhatsApp. Vuelve a conectar y selecciona la cuenta de tu tienda.'));
        return;
      }
      sessionInfo = {
        event: eventName,
        businessId: payload.business_id ?? payload.businessId,
        wabaId: payload.waba_id ?? payload.wabaId,
        phoneNumberId: payload.phone_number_id ?? payload.phoneNumberId,
        displayPhoneNumber: payload.display_phone_number ?? payload.displayPhoneNumber,
      };
      finish();
    };
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => fail(new Error('La autorización de WhatsApp tardó demasiado. Vuelve a abrir Meta desde esta tienda.')), 180000);
    try { FB.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) {
        fail(new Error('Meta no autorizó la conexión. Comprueba que usas la cuenta que administra tu negocio y vuelve a intentarlo. Si aparece «Función no disponible», la plataforma debe revisar su habilitación en Meta.'));
        return;
      }
      loginCode = code;
      finish();
    }, {
      config_id: launch.configId,
      response_type: launch.responseType ?? 'code',
      override_default_response_type: true,
      extras: {
        version: 'v4',
        sessionInfoVersion: '3',
        ...(launch.setupPath === 'business_app_existing' ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
      },
    }); } catch (error) { fail(error); }
  });
}
