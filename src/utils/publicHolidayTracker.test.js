import assert from 'node:assert/strict';
import {
  classifyPublicHolidayShift,
  getPublicHolidayCredits,
  matchGhkaToCredits,
  buildDoctorSummary,
  buildTrackerMatrix
} from './publicHolidayTracker.js';
import { HOLIDAYS } from './holidays.js';

// --- Test 1: classifyPublicHolidayShift ---
// Working shifts
assert.deepEqual(classifyPublicHolidayShift('AM'), {
  normalizedShift: 'AM', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('PM'), {
  normalizedShift: 'PM', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('NIGHT'), {
  normalizedShift: 'NIGHT', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('ON'), {
  normalizedShift: 'NIGHT', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('PN'), {
  normalizedShift: 'PN', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('POSTNIGHT'), {
  normalizedShift: 'PN', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});

// COURSE shifts (should be treated as working just like AM/PM/NIGHT/PN)
assert.deepEqual(classifyPublicHolidayShift('COURSE'), {
  normalizedShift: 'COURSE', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('course'), {
  normalizedShift: 'COURSE', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('COURSE(s)'), {
  normalizedShift: 'COURSE', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});
assert.deepEqual(classifyPublicHolidayShift('COURSE-x'), {
  normalizedShift: 'COURSE', category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
});

// HKA shift
assert.deepEqual(classifyPublicHolidayShift('HKA'), {
  normalizedShift: 'HKA', category: 'official_ph_off', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});

// MC shift (should be treated as not working, like HKA, but reported as MC)
assert.deepEqual(classifyPublicHolidayShift('MC'), {
  normalizedShift: 'MC', category: 'mc', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});
assert.deepEqual(classifyPublicHolidayShift('mc'), {
  normalizedShift: 'MC', category: 'mc', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});
assert.deepEqual(classifyPublicHolidayShift('MC(s)'), {
  normalizedShift: 'MC', category: 'mc', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});
assert.deepEqual(classifyPublicHolidayShift('MC-x'), {
  normalizedShift: 'MC', category: 'mc', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});

// Other leaves (AL, EL, OFF)
assert.deepEqual(classifyPublicHolidayShift('AL'), {
  normalizedShift: 'AL', category: 'other_non_working', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});
assert.deepEqual(classifyPublicHolidayShift('OFF'), {
  normalizedShift: 'OFF', category: 'other_non_working', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
});
assert.deepEqual(classifyPublicHolidayShift(''), {
  normalizedShift: '', category: 'empty', isWorkedPublicHoliday: false, isPublicHolidayOff: false, earnsCredit: false
});

// --- Test 2: getPublicHolidayCredits with COURSE and MC ---
// Pick a known holiday date from HOLIDAYS
const holidayDate = '2026-05-01'; // Labour Day
const testRoster = [
  { Name: 'Dr Alice', Date: holidayDate, Shift: 'COURSE' },
  { Name: 'Dr Bob', Date: holidayDate, Shift: 'MC' },
  { Name: 'Dr Charlie', Date: holidayDate, Shift: 'AM' },
  { Name: 'Dr David', Date: holidayDate, Shift: 'HKA' },
  { Name: 'Dr Eve', Date: holidayDate, Shift: 'OFF' }
];
const doctorNames = ['Dr Alice', 'Dr Bob', 'Dr Charlie', 'Dr David', 'Dr Eve'];

const credits = getPublicHolidayCredits(testRoster, doctorNames);

// Only Alice (COURSE) and Charlie (AM) should earn credits
assert.equal(credits.length, 2);
const aliceCredit = credits.find(c => c.doctorName === 'Dr Alice');
assert.ok(aliceCredit, 'Dr Alice should earn credit for COURSE');
assert.equal(aliceCredit.workedShift, 'COURSE');
assert.equal(aliceCredit.creditEarned, true);

const bobCredit = credits.find(c => c.doctorName === 'Dr Bob');
assert.equal(bobCredit, undefined, 'Dr Bob (MC) should not earn credit');

const charlieCredit = credits.find(c => c.doctorName === 'Dr Charlie');
assert.ok(charlieCredit, 'Dr Charlie should earn credit for AM');

// --- Test 3: Doctor summary calculation ---
const { matchedRecords, unmatchedUsages } = matchGhkaToCredits(credits, [], {}, doctorNames);
const summaries = buildDoctorSummary(matchedRecords, unmatchedUsages, doctorNames, {});

const aliceSummary = summaries.find(s => s.name === 'Dr Alice');
assert.equal(aliceSummary.phWorked, 1, 'Dr Alice phWorked should be 1');
assert.equal(aliceSummary.outstanding, 1, 'Dr Alice outstanding should be 1');

const bobSummary = summaries.find(s => s.name === 'Dr Bob');
assert.equal(bobSummary.phWorked, 0, 'Dr Bob phWorked should be 0');
assert.equal(bobSummary.outstanding, 0, 'Dr Bob outstanding should be 0');

import { normalizeForComparison } from './normalise.js';

// --- Test 4: buildTrackerMatrix classifications ---
const matrix = buildTrackerMatrix(matchedRecords, doctorNames, '2026-05', testRoster);
const mayDayRow = matrix.find(r => r.date === holidayDate);
assert.ok(mayDayRow, 'May Day row must exist in matrix');

const aliceKey = normalizeForComparison('Dr Alice');
const bobKey = normalizeForComparison('Dr Bob');
const davidKey = normalizeForComparison('Dr David');

const aliceCell = mayDayRow.doctors[aliceKey];
assert.ok(aliceCell, 'Dr Alice cell must exist');
assert.equal(aliceCell.classification.category, 'worked');
assert.equal(aliceCell.classification.earnsCredit, true);
assert.equal(aliceCell.classification.normalizedShift, 'COURSE');

const bobCell = mayDayRow.doctors[bobKey];
assert.ok(bobCell, 'Dr Bob cell must exist');
assert.equal(bobCell.classification.category, 'mc');
assert.equal(bobCell.classification.earnsCredit, false);
assert.equal(bobCell.classification.normalizedShift, 'MC');

const davidCell = mayDayRow.doctors[davidKey];
assert.ok(davidCell, 'Dr David cell must exist');
assert.equal(davidCell.classification.category, 'official_ph_off');
assert.equal(davidCell.classification.normalizedShift, 'HKA');

console.log('public holiday tracker tests passed successfully');
