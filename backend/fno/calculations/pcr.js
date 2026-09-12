'use strict';

function sumField(strikes, side, field) {
  if (!Array.isArray(strikes) || !strikes.length) return null;
  let sum = 0;
  let any = false;
  for (const s of strikes) {
    const leg = side === 'call' ? s.call : s.put;
    const v = leg?.[field];
    if (v == null || !Number.isFinite(Number(v))) continue;
    sum += Number(v);
    any = true;
  }
  return any ? sum : null;
}

function computeOiPcr(strikes) {
  const callOi = sumField(strikes, 'call', 'oi');
  const putOi = sumField(strikes, 'put', 'oi');
  if (callOi == null || putOi == null || callOi === 0) return null;
  return putOi / callOi;
}

function computeVolumePcr(strikes) {
  const callVol = sumField(strikes, 'call', 'volume');
  const putVol = sumField(strikes, 'put', 'volume');
  if (callVol == null || putVol == null || callVol === 0) return null;
  return putVol / callVol;
}

function computePcr(strikes) {
  return computeOiPcr(strikes);
}

module.exports = {
  computeOiPcr,
  computeVolumePcr,
  computePcr,
  sumField,
};
