import assert from 'node:assert/strict';
import {
  HOLIDAYS,
  applyCustomPublicHolidays,
  getHolidayName,
  normalizePublicHolidays,
} from './holidays.js';

const normalized = normalizePublicHolidays([
  { Date: '2026-09-03', Name: 'Special Public Holiday', Active: true },
  { date: '2026-09-04', name: 'Inactive Holiday', active: false },
  { Date: 'invalid', Name: 'Ignored' },
  { Date: '2026-09-03', Name: 'Updated Special Holiday' },
]);

assert.deepEqual(normalized, [
  { ID: '2026-09-03', Date: '2026-09-03', Name: 'Updated Special Holiday', Active: true },
  { ID: '2026-09-04', Date: '2026-09-04', Name: 'Inactive Holiday', Active: false },
]);

applyCustomPublicHolidays(normalized);
assert.equal(getHolidayName('2026-09-03'), 'Updated Special Holiday');
assert.equal(getHolidayName('2026-09-04'), '');
assert.equal(getHolidayName('2026-09-16'), 'Malaysia Day');
assert.equal(HOLIDAYS['2026-09-16'], 'Malaysia Day');

applyCustomPublicHolidays([]);
assert.equal(getHolidayName('2026-09-03'), '');
assert.equal(getHolidayName('2026-09-16'), 'Malaysia Day');

console.log('holiday helper tests passed');
