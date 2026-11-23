import { randomBytes } from 'node:crypto';
import { generateVapidKeys } from '../src/pushCrypto';

const keys = generateVapidKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('WEB_PUSH_VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('PUSH_SUBSCRIPTION_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
console.log('PUSH_CAPABILITY_HMAC_KEY=' + randomBytes(32).toString('hex'));
console.log('WEB_PUSH_VAPID_SUBJECT=mailto:replace-with-a-real-support-address');
console.warn('Store the private and encryption keys only in the backend secret environment. Do not commit them.');
