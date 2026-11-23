import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createSign,
  createHash,
  randomBytes,
} from 'node:crypto';

const base64url = (value: Buffer) => value.toString('base64url');
const fromBase64url = (value: string) => Buffer.from(value, 'base64url');

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let total = 0;
  for (let counter = 1; total < length; counter++) {
    previous = createHmac('sha256', prk)
      .update(previous)
      .update(info)
      .update(Buffer.from([counter]))
      .digest();
    blocks.push(previous);
    total += previous.length;
  }
  return Buffer.concat(blocks, total).subarray(0, length);
}

function vapidPrivateKey(rawPrivateKey: Buffer) {
  if (rawPrivateKey.length !== 32) throw new Error('Invalid VAPID private key.');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(rawPrivateKey);
  const publicKey = ecdh.getPublicKey(undefined, 'uncompressed');
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(publicKey.subarray(1, 33)),
      y: base64url(publicKey.subarray(33, 65)),
      d: base64url(rawPrivateKey),
    },
    format: 'jwk',
  });
}

export type VapidKeys = { publicKey: string; privateKey: string };

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: base64url(ecdh.getPublicKey(undefined, 'uncompressed')),
    privateKey: base64url(ecdh.getPrivateKey()),
  };
}

export function createVapidJwt(
  endpoint: string,
  subject: string,
  publicKey: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('Push endpoint must use HTTPS.');
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(Buffer.from(JSON.stringify({
    aud: url.origin,
    exp: nowSeconds + 12 * 60 * 60,
    sub: subject,
  })));
  const signingInput = header + '.' + payload;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: vapidPrivateKey(fromBase64url(privateKey)),
    dsaEncoding: 'ieee-p1363',
  });
  if (fromBase64url(publicKey).length !== 65) throw new Error('Invalid VAPID public key.');
  return signingInput + '.' + base64url(signature);
}

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function encryptPushPayload(
  subscription: Pick<BrowserPushSubscription, 'keys'>,
  payload: Record<string, unknown>,
  salt = randomBytes(16),
  ephemeralPrivateKey?: Buffer,
): Buffer {
  const userAgentPublicKey = fromBase64url(subscription.keys.p256dh);
  const authSecret = fromBase64url(subscription.keys.auth);
  if (userAgentPublicKey.length !== 65 || userAgentPublicKey[0] !== 4 || authSecret.length !== 16) {
    throw new Error('Invalid browser PushSubscription keys.');
  }
  if (salt.length !== 16) throw new Error('Invalid Web Push salt.');

  const ephemeral = createECDH('prime256v1');
  if (ephemeralPrivateKey) ephemeral.setPrivateKey(ephemeralPrivateKey);
  else ephemeral.generateKeys();
  const applicationServerPublicKey = ephemeral.getPublicKey(undefined, 'uncompressed');
  const sharedSecret = ephemeral.computeSecret(userAgentPublicKey);

  // RFC 8291: derive the input keying material from the browser auth secret.
  const authPrk = createHmac('sha256', authSecret).update(sharedSecret).digest();
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userAgentPublicKey,
    applicationServerPublicKey,
  ]);
  const inputKeyMaterial = hkdfExpand(authPrk, keyInfo, 32);

  const prk = createHmac('sha256', salt).update(inputKeyMaterial).digest();
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload), 'utf8'), Buffer.from([2])]);

  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // RFC 8291 aes128gcm body header: salt (16), record size (4), key id length (1), key id.
  const recordHeader = Buffer.alloc(5);
  recordHeader.writeUInt32BE(4096, 0);
  recordHeader[4] = applicationServerPublicKey.length;
  return Buffer.concat([salt, recordHeader, applicationServerPublicKey, ciphertext]);
}

export function encryptPushSecret(value: string, keyHex: string): string {
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('PUSH_SUBSCRIPTION_ENCRYPTION_KEY must be 32-byte hex.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', base64url(iv), base64url(cipher.getAuthTag()), base64url(ciphertext)].join('.');
}

export function decryptPushSecret(value: string, keyHex: string): string {
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('PUSH_SUBSCRIPTION_ENCRYPTION_KEY must be 32-byte hex.');
  const [version, ivText, tagText, ciphertextText, extra] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || ciphertextText === undefined || extra !== undefined) {
    throw new Error('Invalid encrypted Push secret.');
  }
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), fromBase64url(ivText));
  decipher.setAuthTag(fromBase64url(tagText));
  return Buffer.concat([
    decipher.update(fromBase64url(ciphertextText)),
    decipher.final(),
  ]).toString('utf8');
}

export function hashPushCapability(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function createPushCapability(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashPushCapability(token) };
}

export class PushDeliveryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = 'PushDeliveryError';
  }
}

export async function sendWebPush(
  subscription: BrowserPushSubscription,
  payload: Record<string, unknown>,
  config: { vapidPublicKey: string; vapidPrivateKey: string; vapidSubject: string; timeoutMs?: number },
): Promise<number> {
  let endpoint: URL;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    throw new PushDeliveryError('Invalid Push endpoint.', null);
  }
  if (endpoint.protocol !== 'https:') throw new PushDeliveryError('Push endpoint must use HTTPS.', null);

  const authorization = createVapidJwt(
    subscription.endpoint,
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
  const body = encryptPushPayload(subscription, payload);
  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'vapid t=' + authorization + ', k=' + config.vapidPublicKey,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '60',
        Urgency: 'normal',
      },
      body: Uint8Array.from(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? 8000),
    });
  } catch {
    throw new PushDeliveryError('Push provider request failed or timed out.', null);
  }

  if (response.status === 404 || response.status === 410) {
    throw new PushDeliveryError('Push subscription is no longer valid.', response.status);
  }
  if (!response.ok) {
    throw new PushDeliveryError('Push provider returned HTTP ' + response.status + '.', response.status, response.headers.get('retry-after'));
  }
  return response.status;
}
