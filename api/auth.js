import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const secret = process.env.AUTH_SECRET || 'solo-desarrollo-cambiar-esta-clave';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, expectedHex] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createToken(user) {
  const payload = encode({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 28800 });
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readToken(token) {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() / 1000 ? data : null;
}
