import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignature(params: {
  secret: string;
  payload: string | Buffer;
  signature: string; // expects "sha256=<hex>" or "<hex>"
}): boolean {
  const { secret, payload } = params;
  const sig = params.signature.startsWith('sha256=')
    ? params.signature.slice('sha256='.length)
    : params.signature;

  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const expectedHex = createHmac('sha256', secret).update(body).digest('hex');

  try {
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const webhooks = {
  verifySignature,
};

