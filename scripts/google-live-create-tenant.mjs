const baseUrl = process.env.PUBLIC_APP_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
const ownerEmail = process.argv[2] ?? 'lmcorredor@gmail.com';
const storeName = process.argv[3] ?? 'Tienda Piloto Google';

const created = await postJson(`${baseUrl}/api/saas/tenants`, {
  storeName,
  ownerEmail,
  ownerName: ownerEmail,
  whatsappNumber: '',
});

const tenantId = created.tenant.id;
const checkout = await postJson(`${baseUrl}/api/saas/tenants/${tenantId}/subscription/mock-activate`, {});
const oauth = await getJson(`${baseUrl}/api/saas/tenants/${tenantId}/google/oauth/start?loginHint=${encodeURIComponent(ownerEmail)}`);

console.log(JSON.stringify({
  tenantId,
  subscription: checkout.subscription.status,
  oauthReady: oauth.ready,
  redirectUri: oauth.redirectUri,
  authorizationUrl: oauth.authorizationUrl,
}, null, 2));

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
