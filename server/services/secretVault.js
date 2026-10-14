import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export class SecretVault {
  constructor({ store, encryptionKey = process.env.SECRET_ENCRYPTION_KEY ?? process.env.GOOGLE_TOKEN_ENCRYPTION_KEY }) {
    this.store = store;
    this.key = encryptionKey ? crypto.createHash('sha256').update(String(encryptionKey)).digest() : null;
  }

  available() {
    return Boolean(this.key);
  }

  saveSecret({ tenantId, name, value, provider = 'local_encrypted', purpose = '' }) {
    if (!value) return null;
    if (!this.key) {
      const error = new Error('SECRET_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY is required to store live secrets');
      error.statusCode = 500;
      error.code = 'secret_vault_not_configured';
      throw error;
    }
    const ref = `${tenantId.toUpperCase()}_${name.toUpperCase()}_REF`;
    const encrypted = encrypt(value, this.key);
    this.store.mutate((state) => {
      ensureSecretState(state);
      const current = state.secretsByRef[ref] ?? {};
      state.secretsByRef[ref] = {
        ref,
        tenantId,
        name,
        provider,
        purpose,
        ...encrypted,
        createdAt: current.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    return ref;
  }

  readSecret(ref) {
    if (!ref) return null;
    if (process.env[ref]) return process.env[ref];
    if (!this.key) return null;
    const record = this.store.getState().secretsByRef?.[ref];
    if (!record) return null;
    return decrypt(record, this.key);
  }
}

export function ensureSecretState(state) {
  state.secretsByRef ??= {};
}

function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: ALGORITHM,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

function decrypt(record, key) {
  if (record.algorithm !== ALGORITHM) throw new Error(`Unsupported secret algorithm: ${record.algorithm}`);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
