// Meta BSUIDs are opaque, portfolio-scoped identifiers, never phone numbers.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
export function isWhatsAppBusinessScopedId(value) {
  return typeof value === 'string' && /^[A-Z]{2}\.(?:ENT\.)?[a-zA-Z0-9]{1,128}$/.test(value);
}

export function requireWhatsAppRecipient(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error('WhatsApp recipient identity is required'), {
      code: 'whatsapp_recipient_missing', statusCode: 422,
    });
  }
  return value.trim();
}

export function whatsAppRecipientFields(value) {
  const recipient = requireWhatsAppRecipient(value);
  return isWhatsAppBusinessScopedId(recipient) ? { recipient } : { to: recipient };
}
