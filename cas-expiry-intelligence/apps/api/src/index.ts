import cors from 'cors';
import express from 'express';
import { API_CONFIG } from './config.js';
import { getDb } from './db/client.js';
import { router } from './routes/api.js';

const app = express();
app.use(cors({ origin: API_CONFIG.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'CAS & Expiry Intelligence API',
    docs: '/api/health',
    trading: 'DISABLED',
  });
});

app.use('/api', router);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api]', err?.message ?? err);
  res.status(500).json({ error: 'Internal server error' });
});

getDb();

app.listen(API_CONFIG.port, () => {
  console.log(`CAS API listening on http://localhost:${API_CONFIG.port}`);
  console.log('Order execution APIs: DISABLED');
});
