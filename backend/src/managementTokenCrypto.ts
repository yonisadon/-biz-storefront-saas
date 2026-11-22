import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './config';
import { HttpError } from './errors';

function encryptionKey(): Buffer {
  if (!env.MANAGEMENT_TOKEN_ENCRYPTION_KEY) {
    throw new HttpError(503, 'management_token_encryption_not_configured');
  }
  return Buffer.from(env.MANAGEMENT_TOKEN_ENCRYPTION_KEY, 'hex');
}

export function encryptManagementToken(token: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', nonce.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptManagementToken(encoded: string): string {
  const [version, noncePart, tagPart, ciphertextPart, extra] = encoded.split('.');
  if (version !== 'v1' || !noncePart || !tagPart || !ciphertextPart || extra !== undefined) {
    throw new HttpError(503, 'management_link_unavailable');
  }
  try {
    const nonce = Buffer.from(noncePart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('invalid_encrypted_management_token');
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpError(503, 'management_link_unavailable');
  }
}

export function createManagementToken(): { token: string; tokenHash: Buffer; encryptedToken: string } {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token, 'utf8').digest(),
    encryptedToken: encryptManagementToken(token),
  };
}

export function managementTokenMatches(token: string, expectedHash: Buffer): boolean {
  const actualHash = createHash('sha256').update(token, 'utf8').digest();
  return expectedHash.length === actualHash.length && timingSafeEqual(actualHash, expectedHash);
}
