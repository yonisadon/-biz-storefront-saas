import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
} from 'node:crypto';
import {
  derivePushCapabilityToken,
  createVapidJwt,
  decryptPushSecret,
  encryptPushPayload,
  encryptPushSecret,
  generateVapidKeys,
  hashPushCapability,
  isSupportedPushEndpoint,
} from '../src/pushCrypto';

const b64u = (value: Buffer) => value.toString('base64url');
const fromB64u = (value: string) => Buffer.from(value, 'base64url');

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let total = 0;
  for (let counter = 1; total < length; counter++) {
    previous = createHmac('sha256', prk).update(previous).update(info).update(Buffer.from([counter])).digest();
    blocks.push(previous);
    total += previous.length;
  }
  return Buffer.concat(blocks, total).subarray(0, length);
}

function decryptForTest(body: Buffer, clientPrivate: Buffer, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const keyIdLength = body[20];
  const applicationServerPublicKey = body.subarray(21, 21 + keyIdLength);
  const encrypted = body.subarray(21 + keyIdLength);

  const client = createECDH('prime256v1');
  client.setPrivateKey(clientPrivate);
  const clientPublicKey = client.getPublicKey(undefined, 'uncompressed');
  const sharedSecret = client.computeSecret(applicationServerPublicKey);
  const authPrk = createHmac('sha256', authSecret).update(sharedSecret).digest();
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    clientPublicKey,
    applicationServerPublicKey,
  ]);
  const ikm = hkdfExpand(authPrk, keyInfo, 32);
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { json: plaintext.subarray(0, -1).toString('utf8'), delimiter: plaintext.at(-1), recordSize };
}

test('Push endpoint allowlist accepts known providers and rejects arbitrary or local URLs', () => {
  assert.equal(isSupportedPushEndpoint('https://fcm.googleapis.com/fcm/send/example'), true);
  assert.equal(isSupportedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example'), true);
  assert.equal(isSupportedPushEndpoint('https://web.push.apple.com/example'), true);
  assert.equal(isSupportedPushEndpoint('http://localhost:5432/private'), false);
  assert.equal(isSupportedPushEndpoint('https://example.com/hook'), false);
});

test('VAPID JWT uses the endpoint origin and a verifiable ES256 signature', () => {
  const keys = generateVapidKeys();
  assert.equal(fromB64u(keys.privateKey).length, 32);
  const endpoint = 'https://push.example.test/send/abc';
  const jwt = createVapidJwt(endpoint, 'mailto:push@example.test', keys.publicKey, keys.privateKey, 1_800_000_000);
  const [header, payload, signature] = jwt.split('.');
  const publicBytes = fromB64u(keys.publicKey);
  const publicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(publicBytes.subarray(1, 33)),
      y: b64u(publicBytes.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const verifier = createVerify('SHA256');
  verifier.update(header + '.' + payload);
  verifier.end();
  assert.equal(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64u(signature)), true);
  assert.deepEqual(JSON.parse(fromB64u(header).toString('utf8')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(fromB64u(payload).toString('utf8')), {
    aud: 'https://push.example.test',
    exp: 1_800_043_200,
    sub: 'mailto:push@example.test',
  });
});

test('VAPID signing normalizes private scalars with omitted leading zero bytes', () => {
  const scalar = Buffer.from([1]);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(scalar);
  const publicKey = b64u(ecdh.getPublicKey(undefined, 'uncompressed'));
  const jwt = createVapidJwt(
    'https://push.example.test/send/short-scalar',
    'mailto:push@example.test',
    publicKey,
    b64u(scalar),
    1_800_000_000,
  );
  const [header, payload, signature] = jwt.split('.');
  const publicBytes = fromB64u(publicKey);
  const key = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(publicBytes.subarray(1, 33)),
      y: b64u(publicBytes.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const verifier = createVerify('SHA256');
  verifier.update(header + '.' + payload);
  verifier.end();
  assert.equal(verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, fromB64u(signature)), true);
});

test('Web Push payload is encrypted using aes128gcm and can be decrypted by the subscriber', () => {
  const client = createECDH('prime256v1');
  client.generateKeys();
  const clientPrivate = client.getPrivateKey();
  const authSecret = randomBytes(16);
  const salt = randomBytes(16);
  const subscription = {
    keys: {
      p256dh: b64u(client.getPublicKey(undefined, 'uncompressed')),
      auth: b64u(authSecret),
    },
  };
  const payload = { title: 'עדכון חדש', body: 'יש עדכון לגבי התור שלך', url: '/biz/example' };
  const encrypted = encryptPushPayload(subscription, payload, salt);
  const decrypted = decryptForTest(encrypted, clientPrivate, authSecret);
  assert.deepEqual(JSON.parse(decrypted.json), payload);
  assert.equal(decrypted.delimiter, 2);
  assert.equal(decrypted.recordSize, 4096);
  assert.equal(encrypted.subarray(0, 16).equals(salt), true);
});

test('subscription secrets are encrypted at rest and reject tampering', () => {
  const key = randomBytes(32).toString('hex');
  const original = 'https://push.example.test/endpoint?secret=opaque';
  const encrypted = encryptPushSecret(original, key);
  assert.notEqual(encrypted, original);
  assert.equal(decryptPushSecret(encrypted, key), original);
  const parts = encrypted.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.throws(() => decryptPushSecret(parts.join('.'), key));
});

test('booking capability token is deterministic for one booking but bound to tenant, target and expiry', () => {
  const key = randomBytes(32).toString('hex');
  const expiresAt = new Date('2026-12-01T10:00:00.000Z');
  const first = derivePushCapabilityToken('tenant-a', 'appointment', 'booking-a', 'cap-a', expiresAt, key);
  const retry = derivePushCapabilityToken('tenant-a', 'appointment', 'booking-a', 'cap-a', expiresAt, key);
  const otherBooking = derivePushCapabilityToken('tenant-a', 'appointment', 'booking-b', 'cap-a', expiresAt, key);
  const otherTenant = derivePushCapabilityToken('tenant-b', 'appointment', 'booking-a', 'cap-a', expiresAt, key);
  assert.equal(first, retry);
  assert.notEqual(first, otherBooking);
  assert.notEqual(first, otherTenant);
  assert.equal(hashPushCapability(first).length, 32);
});

