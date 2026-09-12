'use strict';

const { computeOiPcr, computeVolumePcr } = require('./pcr');
const { computeMaxPain } = require('./maxPain');
const { computeExpectedMove, straddleImpliedRange } = require('./expectedMove');

function daysToExpiry(expiry, asOf = new Date()) {
  if (!expiry) return null;
  const exp = new Date(`${expiry}T15:30:00+05:30`);
  const now = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(exp.getTime()) || Number.isNaN(now.getTime())) return null;
  const ms = exp.getTime() - now.getTime();
  const days = ms / (24 * 60 * 60 * 1000);
  return Math.max(days, 0.5);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function analyzeOptionChain({ spot, strikes, expiry, asOf } = {}) {
  if (spot == null || !Number.isFinite(Number(spot)) || !Array.isArray(strikes) || !strikes.length) {
    return {
      spot: spot ?? null,
      expiry: expiry ?? null,
      asOf: asOf ?? null,
      atm: null,
      pcr: null,
      volumePcr: null,
      maxPain: null,
      callResistance: null,
      putSupport: null,
      atmIv: null,
      dteDays: null,
      highestCallOi: null,
      highestPutOi: null,
      highestCallOiAddition: null,
      highestPutOiAddition: null,
      unusualVolume: [],
      significantIvChanges: [],
      metrics: {},
      highlights: {},
      expectedMove: null,
      interpretation: {
        summary: 'Insufficient option-chain data',
        evidence: ['Spot or strikes missing — no interpretation generated'],
        notes: ['No naked BUY/SELL — metrics unavailable'],
      },
    };
  }

  const spotN = Number(spot);
  const sorted = [...strikes]
    .map((s) => ({
      ...s,
      strike: Number(s.strike),
      call: s.call || {},
      put: s.put || {},
    }))
    .filter((s) => Number.isFinite(s.strike))
    .sort((a, b) => a.strike - b.strike);

  let atm = sorted[0];
  let atmDist = Math.abs(sorted[0].strike - spotN);
  for (const s of sorted) {
    const d = Math.abs(s.strike - spotN);
    if (d < atmDist) {
      atm = s;
      atmDist = d;
    }
  }

  const findMax = (side, field) => {
    let best = null;
    for (const s of sorted) {
      const v = Number(s[side]?.[field]);
      if (!Number.isFinite(v)) continue;
      if (!best || v > best.value) best = { strike: s.strike, value: v };
    }
    return best;
  };

  const oiChange = (leg) => {
    if (leg?.oi == null) return null;
    if (leg.previousOi == null && leg.oiChange == null) return null;
    if (leg.oiChange != null) return Number(leg.oiChange);
    return Number(leg.oi) - Number(leg.previousOi);
  };

  let maxCallOiAdd = null;
  let maxPutOiAdd = null;
  for (const s of sorted) {
    const cAdd = oiChange(s.call);
    const pAdd = oiChange(s.put);
    if (cAdd != null && (!maxCallOiAdd || cAdd > maxCallOiAdd.value)) {
      maxCallOiAdd = { strike: s.strike, value: cAdd };
    }
    if (pAdd != null && (!maxPutOiAdd || pAdd > maxPutOiAdd.value)) {
      maxPutOiAdd = { strike: s.strike, value: pAdd };
    }
  }

  const volumes = [];
  for (const s of sorted) {
    if (s.call?.volume != null) volumes.push(Number(s.call.volume));
    if (s.put?.volume != null) volumes.push(Number(s.put.volume));
  }
  const medVol = median(volumes.filter((v) => Number.isFinite(v) && v >= 0));
  const unusualVolume = [];
  if (medVol != null && medVol > 0) {
    for (const s of sorted) {
      for (const side of ['call', 'put']) {
        const vol = Number(s[side]?.volume);
        if (Number.isFinite(vol) && vol > 2 * medVol) {
          unusualVolume.push({ strike: s.strike, side, volume: vol });
        }
      }
    }
  }

  const significantIvChange = [];
  for (const s of sorted) {
    for (const side of ['call', 'put']) {
      const iv = s[side]?.iv;
      const prev = s[side]?.previousIv;
      if (iv == null || prev == null) continue;
      const delta = Number(iv) - Number(prev);
      if (Math.abs(delta) >= 3) {
        significantIvChange.push({ strike: s.strike, side, ivDelta: delta });
      }
    }
  }

  const oiPcr = computeOiPcr(sorted);
  const volumePcr = computeVolumePcr(sorted);
  const maxPainResult = computeMaxPain(sorted);
  const callResistance = findMax('call', 'oi');
  const putSupport = findMax('put', 'oi');

  const atmIvCall = atm.call?.iv != null ? Number(atm.call.iv) : null;
  const atmIvPut = atm.put?.iv != null ? Number(atm.put.iv) : null;
  const atmIv =
    atmIvCall != null && atmIvPut != null
      ? (atmIvCall + atmIvPut) / 2
      : atmIvCall ?? atmIvPut;

  const dte = daysToExpiry(expiry, asOf);
  const expectedMove = computeExpectedMove({ spot: spotN, atmIv, dteDays: dte });

  const atmStraddle =
    atm.call?.ltp != null && atm.put?.ltp != null
      ? Number(atm.call.ltp) + Number(atm.put.ltp)
      : null;
  const straddleRange = straddleImpliedRange({ straddlePrice: atmStraddle, spot: spotN });

  const evidence = [];
  evidence.push(`ATM ${atm.strike} (spot ${spotN})`);
  if (oiPcr != null) evidence.push(`OI PCR ${oiPcr.toFixed(2)}`);
  if (volumePcr != null) evidence.push(`Volume PCR ${volumePcr.toFixed(2)}`);
  if (callResistance) evidence.push(`Call OI resistance @ ${callResistance.strike} (OI ${callResistance.value})`);
  if (putSupport) evidence.push(`Put OI support @ ${putSupport.strike} (OI ${putSupport.value})`);
  if (maxPainResult) evidence.push(`Max pain ${maxPainResult.maxPain}`);
  if (atmIv != null) evidence.push(`ATM IV ${atmIv.toFixed(2)}%`);
  if (expectedMove) {
    evidence.push(
      `Expected move ±${expectedMove.move.toFixed(2)} → [${expectedMove.lower1sd.toFixed(2)}, ${expectedMove.upper1sd.toFixed(2)}]`,
    );
  }
  if (maxCallOiAdd) evidence.push(`Largest call OI add @ ${maxCallOiAdd.strike} (+${maxCallOiAdd.value})`);
  if (maxPutOiAdd) evidence.push(`Largest put OI add @ ${maxPutOiAdd.strike} (+${maxPutOiAdd.value})`);

  let summary = 'Neutral / mixed options positioning';
  if (oiPcr != null && oiPcr >= 1.2 && putSupport) {
    summary = 'Put-heavy chain — evidence of downside hedges / support near high put OI';
  } else if (oiPcr != null && oiPcr <= 0.7 && callResistance) {
    summary = 'Call-heavy chain — evidence of upside supply / resistance near high call OI';
  }

  const highestCallOiRaw = findMax('call', 'oi');
  const highestPutOiRaw = findMax('put', 'oi');

  return {
    spot: spotN,
    expiry: expiry ?? null,
    asOf: asOf ? new Date(asOf).toISOString() : new Date().toISOString(),
    atm: {
      strike: atm.strike,
      iv: atmIv,
      callLtp: atm.call?.ltp ?? null,
      putLtp: atm.put?.ltp ?? null,
      straddle: atmStraddle,
    },
    // Convenience top-level mirrors (also under metrics/highlights)
    pcr: oiPcr,
    volumePcr,
    maxPain: maxPainResult?.maxPain ?? null,
    callResistance: callResistance
      ? { strike: callResistance.strike, oi: callResistance.value }
      : null,
    putSupport: putSupport ? { strike: putSupport.strike, oi: putSupport.value } : null,
    atmIv,
    dteDays: dte,
    highestCallOi: highestCallOiRaw
      ? { strike: highestCallOiRaw.strike, oi: highestCallOiRaw.value, side: 'call' }
      : null,
    highestPutOi: highestPutOiRaw
      ? { strike: highestPutOiRaw.strike, oi: highestPutOiRaw.value, side: 'put' }
      : null,
    highestCallOiAddition: maxCallOiAdd
      ? { strike: maxCallOiAdd.strike, oiAddition: maxCallOiAdd.value, side: 'call' }
      : null,
    highestPutOiAddition: maxPutOiAdd
      ? { strike: maxPutOiAdd.strike, oiAddition: maxPutOiAdd.value, side: 'put' }
      : null,
    unusualVolume,
    significantIvChanges: significantIvChange,
    metrics: {
      oiPcr,
      volumePcr,
      maxPain: maxPainResult?.maxPain ?? null,
      callOiResistance: callResistance,
      putOiSupport: putSupport,
      atmIv,
      dteDays: dte,
      straddleImpliedRange: straddleRange,
    },
    highlights: {
      highestCallOi: highestCallOiRaw,
      highestPutOi: highestPutOiRaw,
      highestCallOiAddition: maxCallOiAdd,
      highestPutOiAddition: maxPutOiAdd,
      unusualVolume,
      significantIvChange,
    },
    expectedMove,
    interpretation: {
      summary,
      evidence,
      notes: [
        'Interpretation is metric-backed only — no naked BUY/SELL recommendation',
        'Combine PCR, max pain, OI walls and expected move before acting',
      ],
    },
    strikes: sorted,
  };
}

module.exports = {
  analyzeOptionChain,
  daysToExpiry,
  dteFromExpiry: daysToExpiry,
};
