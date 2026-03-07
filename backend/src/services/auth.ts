/**
 * Auth: password hashing, JWT issue/verify, API key lookup.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '../db/prisma.js';
import { config } from '../config.js';

const SALT_ROUNDS = 10;
const API_KEY_PREFIX = 'vai_';
const API_KEY_BYTES = 24;

export type JwtPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  role: string;
  iat?: number;
  exp?: number;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const expiresIn = config.jwtExpiresIn === '7d' ? 7 * 24 * 60 * 60 : parseInt(String(config.jwtExpiresIn), 10) || 604800;
  return jwt.sign(payload as object, config.jwtSecret, { expiresIn });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function generateApiKey(): { raw: string; hash: string } {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_BYTES).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export async function findWorkspaceByApiKey(key: string): Promise<{ workspaceId: string } | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const row = await prisma.apiKey.findFirst({
    where: { key: hash },
    select: { workspaceId: true },
  });
  return row ? { workspaceId: row.workspaceId } : null;
}
