// backend/sectorUniverse.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIndexCsvWithIndustry, shortenSector } = require('./sectorUniverse');

test('parseIndexCsvWithIndustry extracts symbol and industry', () => {
  const csv = `Company Name,Industry,Symbol,Series,ISIN Code
Foo Ltd.,Information Technology,INFY,EQ,INE009A01021
Bar Ltd.,Financial Services,HDFCBANK,EQ,INE040A01034
`;
  const rows = parseIndexCsvWithIndustry(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, 'INFY');
  assert.equal(rows[0].sector, 'Information Technology');
  assert.equal(rows[1].symbol, 'HDFCBANK');
});

test('shortenSector maps known industries', () => {
  assert.equal(shortenSector('Information Technology'), 'IT');
  assert.equal(shortenSector('Fast Moving Consumer Goods'), 'FMCG');
});
