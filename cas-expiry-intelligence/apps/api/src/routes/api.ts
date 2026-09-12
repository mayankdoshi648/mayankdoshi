import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_CAS_MODE, type CasMode } from '@cas/shared';
import { deleteSetting, getSetting, setSetting } from '../db/client.js';
import { encryptSecret } from '../utils/crypto.js';
import { hasDhanCredentials } from '../services/dhanClient.js';
import {
  buildAnalytics,
  listCasModes,
  listExpiries,
  listInstruments,
} from '../services/analyticsService.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'cas-expiry-intelligence-api',
    dhanConfigured: hasDhanCredentials(),
    tradingApis: 'DISABLED',
    now: new Date().toISOString(),
  });
});

router.get('/instruments', (_req, res) => {
  res.json({ instruments: listInstruments() });
});

router.get('/cas/modes', (_req, res) => {
  res.json({ modes: listCasModes(), defaultMode: DEFAULT_CAS_MODE });
});

router.get('/settings/dhan', (_req, res) => {
  const configured = hasDhanCredentials();
  const clientIdEnc = getSetting('dhan.clientId');
  res.json({
    configured,
    clientIdMasked: configured && clientIdEnc ? '••••••••' : null,
    // Never return access token
  });
});

router.put('/settings/dhan', (req, res) => {
  const schema = z.object({
    clientId: z.string().min(3),
    accessToken: z.string().min(10),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  setSetting('dhan.clientId', encryptSecret(parsed.data.clientId.trim()));
  setSetting('dhan.accessToken', encryptSecret(parsed.data.accessToken.trim()));
  res.json({ ok: true, configured: true });
});

router.delete('/settings/dhan', (_req, res) => {
  deleteSetting('dhan.clientId');
  deleteSetting('dhan.accessToken');
  res.json({ ok: true, configured: false });
});


router.get('/settings/futures', (_req, res) => {
  const instruments = listInstruments();
  res.json({
    mappings: instruments.map((i) => ({
      instrumentId: i.id,
      displayName: i.displayName,
      futuresSegment: i.futuresSegment,
      securityId: getSetting(`futures.${i.id}.securityId`) ?? i.futuresSecurityId ?? null,
    })),
  });
});

router.put('/settings/futures', (req, res) => {
  const schema = z.object({
    ids: z.record(z.string()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  for (const [instrumentId, securityId] of Object.entries(parsed.data.ids)) {
    const key = `futures.${instrumentId.toUpperCase()}.securityId`;
    const val = String(securityId ?? '').trim();
    if (!val) deleteSetting(key);
    else setSetting(key, val);
  }
  res.json({ ok: true });
});

router.get('/instruments/:id/expiries', async (req, res) => {
  try {
    const expiries = await listExpiries(req.params.id);
    res.json({ instrumentId: req.params.id.toUpperCase(), expiries });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to load expiries' });
  }
});

router.get('/analytics/:id', async (req, res) => {
  try {
    const casMode = (String(req.query.casMode ?? DEFAULT_CAS_MODE) as CasMode) ?? DEFAULT_CAS_MODE;
    const expiry = req.query.expiry ? String(req.query.expiry) : null;
    const wings = req.query.wings ? Number(req.query.wings) : 5;
    const data = await buildAnalytics({
      instrumentId: req.params.id,
      expiry,
      casMode,
      wingStrikes: Number.isFinite(wings) ? wings : 5,
    });
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Analytics failed' });
  }
});

router.get('/cas/history', (req, res) => {
  // Historical CAS rows — never fabricate. Empty until official/user-imported data exists.
  res.json({
    rows: [],
    notice: 'UNAVAILABLE — official historical CAS series not loaded. Do not invent CAS prices.',
    filters: {
      instrumentId: req.query.instrumentId ?? null,
      from: req.query.from ?? null,
      to: req.query.to ?? null,
    },
  });
});

router.get('/backtests', (_req, res) => {
  res.json({
    runs: [],
    notice: 'Backtest engine scaffolded. Results unavailable until historical CAS/option data is imported.',
  });
});
