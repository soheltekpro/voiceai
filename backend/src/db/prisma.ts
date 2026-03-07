import { PrismaClient } from '../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

export const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new pg.Pool({
      connectionString: process.env['DATABASE_URL'],
    })
  ),
  log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
});

