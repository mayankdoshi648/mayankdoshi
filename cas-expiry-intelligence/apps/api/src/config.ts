import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config();

export const API_CONFIG = {
  port: Number(process.env.PORT ?? 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(root, 'data', 'cas.db'),
  credentialSecret: process.env.CREDENTIAL_SECRET ?? 'dev-only-change-me',
  dhanBaseUrl: process.env.DHAN_BASE_URL ?? 'https://api.dhan.co',
};
