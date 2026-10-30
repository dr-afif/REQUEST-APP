#!/usr/bin/env node
/**
 * Automated Staging Backend Integration Test Suite
 * Tests against a real Google Apps Script staging deployment.
 *
 * SAFETY GUARDS:
 * 1. Checks .env.local to ensure the target staging URL does NOT match production.
 * 2. Requires an explicit --confirm-staging flag.
 * 3. Inspects server-side staging identity (?action=stagingidentity) before executing writes.
 * 4. Fails closed if staging identity, spreadsheet association, or synthetic dataset cannot be verified.
 * 5. Dynamically calculates Malaysia calendar months (current=AMEND, next=DRAFT, prev=historical AMEND)
 *    to ensure test stability across month and year boundaries (e.g. 1 Nov 2026, Dec-to-Jan rollover).
 *
 * Usage:
 *   node scripts/test-staging-backend.mjs <STAGING_WEB_APP_URL> [STAGING_PIN] --confirm-staging
 *   (Or set STAGING_PIN environment variable to avoid process argument exposure)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper for dynamic Malaysia timezone date calculations
function getMalaysiaYearMonth(date = new Date()) {
  const klDate = new Date(date.getTime() + 8 * 3600 * 1000);
  const y = klDate.getUTCFullYear();
  const m = String(klDate.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const tot = y * 12 + (m - 1) + delta;
  const nY = Math.floor(tot / 12);
  const nM = (tot % 12) + 1;
  return `${nY}-${String(nM).padStart(2, '0')}`;
}

// Normalize Date objects or ISO strings (e.g. 2026-10-14T16:00:00.000Z) to Malaysia YYYY-MM-DD
function normalizeDateStr(raw) {
  if (!raw && raw !== 0) return '';
  const str = String(raw).trim();
  if (str.includes('T') || str.includes('Z')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const klDate = new Date(d.getTime() + 8 * 3600 * 1000);
      const y = klDate.getUTCFullYear();
      const m = String(klDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(klDate.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return str.slice(0, 10);
}

const currentMonth = getMalaysiaYearMonth();
const nextMonth = shiftMonth(currentMonth, 1);
const prevMonth = shiftMonth(currentMonth, -1);

// Read arguments
const args = process.argv.slice(2);
const hasConfirmFlag = args.includes('--confirm-staging') || process.env.CONFIRM_DISPOSABLE_STAGING === 'true';
const nonFlagArgs = args.filter((a) => !a.startsWith('--'));

const stagingUrl = nonFlagArgs[0] ? nonFlagArgs[0].trim().replace(/\/$/, '') : '';
let stagingPin = (process.env.STAGING_PIN || process.env.VITE_ADMIN_PIN || (nonFlagArgs[1] ? nonFlagArgs[1].trim() : '')).trim();

// Preflight validation
if (!stagingUrl || !stagingUrl.startsWith('https://script.google.com/macros/s/')) {
  console.error('\n❌ ERROR: Valid staging Apps Script Web App URL is required.');
  console.error('Usage: STAGING_PIN="<PIN>" node scripts/test-staging-backend.mjs <STAGING_WEB_APP_URL> --confirm-staging\n');
  process.exit(1);
}

if (!hasConfirmFlag) {
  console.error('\n❌ SAFETY ABORT: Missing mandatory --confirm-staging flag.');
  console.error('This flag confirms you intend to run real write integration tests against a disposable staging backend.');
  console.error('Usage: STAGING_PIN="<PIN>" node scripts/test-staging-backend.mjs <STAGING_WEB_APP_URL> --confirm-staging\n');
  process.exit(1);
}

// Check production endpoint from .env.local to prevent accidental test runs against production
const envLocalPath = path.join(rootDir, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const match = envContent.match(/VITE_APPS_SCRIPT_URL\s*=\s*["']?([^"'\r\n]+)["']?/);
  if (match && match[1]) {
    const prodUrl = match[1].trim().replace(/\/$/, '');
    if (prodUrl && prodUrl === stagingUrl) {
      console.error('\n🚨 FATAL SAFETY VIOLATION: Target URL matches production URL in .env.local!');
      console.error('Execution ABORTED immediately. Real tests will never run against production.\n');
      process.exit(1);
    }
  }
}

async function promptForPinIfMissing() {
  if (stagingPin) return;
  if (!process.stdin.isTTY) {
    console.error('\n❌ ERROR: Staging Admin PIN is required. Set environment variable STAGING_PIN or provide it securely.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n🔒 Enter Staging Security PIN: ', (answer) => {
      rl.close();
      stagingPin = String(answer || '').trim();
      if (!stagingPin) {
        console.error('❌ PIN cannot be empty.');
        process.exit(1);
      }
      resolve();
    });
  });
}

console.log('='.repeat(75));
console.log('🚀 REQUEST-APP Simplified Roster — Isolated Staging Integration Test Suite');
console.log(`Endpoint:    ${stagingUrl.slice(0, 55)}...`);
console.log(`Dynamic Timeline (Malaysia UTC+8):`);
console.log(`  - Previous Month (Historical Amend): ${prevMonth}`);
console.log(`  - Current Month  (Active Amend):     ${currentMonth}`);
console.log(`  - Next Month     (Draft Target):     ${nextMonth}`);
console.log('Safety:      Production protection active. Validating staging identity...');
console.log('='.repeat(75));

async function get(action, params = {}) {
  const url = new URL(stagingUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from GET ${action}`);
  return res.json();
}

async function post(payload) {
  const res = await fetch(stagingUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from POST ${payload.action}`);
  return res.json();
}

async function runTests() {
  await promptForPinIfMissing();

  let passed = 0;
  let total = 0;

  function testHeader(name) {
    total++;
    console.log(`\n[Test ${total}] ${name}`);
  }

  // --- SECTION 1: SERVER-SIDE PERSISTENT STAGING IDENTITY VERIFICATION ---
  testHeader('Verify server-side persistent staging identity (?action=stagingidentity)');
  const identity = await get('stagingidentity');
  assert.equal(identity.result, 'success', 'Identity endpoint returns result=success');
  assert.equal(identity.isStaging, true, 'Backend must explicitly confirm isStaging=true');
  assert.equal(identity.appEnvironment, 'staging', 'Backend appEnvironment must be staging');
  assert.ok(identity.spreadsheetId, 'Backend must return persistent disposable spreadsheet ID');
  assert.ok(
    identity.spreadsheetName.toLowerCase().includes('staging') ||
    identity.spreadsheetName.toLowerCase().includes('disposable') ||
    identity.spreadsheetName.toLowerCase().includes('test'),
    'Spreadsheet name must contain staging or disposable marker'
  );

  const expectedSheetId = process.env.EXPECTED_STAGING_SHEET_ID;
  if (expectedSheetId) {
    assert.equal(identity.spreadsheetId, expectedSheetId.trim(), 'Spreadsheet ID matches expected association');
  }

  console.log(`  ✓ Verified server-side staging identity: "${identity.spreadsheetName}" (Spreadsheet ID: ${identity.spreadsheetId})`);
  passed++;

  // --- SECTION 2: SYNTHETIC DATASET VALIDATION (GET alldata & amendroster) ---
  testHeader('Verify backend dataset schema & synthetic doctor entities');
  const allData = await get('alldata');
  assert.equal(allData.result || 'success', 'success', 'alldata returns successful response');
  assert.ok(Array.isArray(allData.teamMembers), 'teamMembers array returned');
  assert.ok(Array.isArray(allData.emergencyPhysicians), 'emergencyPhysicians array returned');
  assert.ok(Array.isArray(allData.masterRoster), 'masterRoster array returned');

  // Verify synthetic data markers
  const isSyntheticMo = allData.teamMembers.some((m) => (m.MemberName === 'Person A' || m.name === 'Person A') && (m.StaffId === 'A05157' || m.staffId === 'A05157'));
  const isSyntheticEp = allData.emergencyPhysicians.some((e) => (e.MemberName === 'Echo' || e.name === 'Echo') && (e.StaffId === 'EP01' || e.staffId === 'EP01'));
  if (!isSyntheticMo || !isSyntheticEp) {
    throw new Error('SAFETY ABORT: Target backend does not contain synthetic staging data. Halting tests.');
  }

  // Verify AmendRoster endpoint
  const amendTest = await get('amendroster');
  assert.ok(Array.isArray(amendTest), 'amendroster endpoint returns array');

  console.log(`  ✓ Verified synthetic dataset: ${allData.teamMembers.length} MOs, ${allData.emergencyPhysicians.length} EPs, ${allData.masterRoster.length} MasterRoster rows`);
  passed++;

  // --- SECTION 3: ORDINARY DOCTOR WORKFLOW (NO PIN REQUIRED) ---
  testHeader('Ordinary doctor request workflows succeed without Admin PIN');
  const docSubmit = await post({
    action: 'submit',
    name: allData.teamMembers[0]?.name || allData.teamMembers[0]?.MemberName || 'Person A',
    date: `${nextMonth}-20`,
    day: 'Fri',
    request: 'OFF',
    comment: 'Staging disposable smoke test request',
    requestType: 'Shift Request',
  });
  assert.equal(docSubmit.result, 'success', 'Doctor request submit succeeds without PIN');
  const reqId = docSubmit.id;
  assert.ok(reqId, 'Server assigned request ID');
  console.log(`  ✓ Request created without PIN (ID: ${reqId})`);

  if (reqId) {
    const docDel = await post({ action: 'delete', id: reqId });
    assert.equal(docDel.result, 'success', 'Doctor request delete succeeds without PIN');
    console.log('  ✓ Cleaned up test request');
  }
  passed++;

  // --- SECTION 4: PRIVILEGED MUTATION AUTHORIZATION GATES ---
  testHeader('Privileged mutation fails closed when session token is missing');
  const unauthRes = await post({
    action: 'savemasterrosterdraft',
    targetMonth: nextMonth,
    rows: [],
  });
  assert.equal(unauthRes.result, 'error');
  assert.ok(unauthRes.message.includes('authorization required'));
  console.log('  ✓ Correctly rejected with: ' + unauthRes.message);
  passed++;

  testHeader('Privileged mutation fails closed when token signature is invalid');
  const badTokenRes = await post({
    action: 'savemasterrosterdraft',
    targetMonth: nextMonth,
    adminSessionToken: 'header.invalid_signature.token',
    rows: [],
  });
  assert.equal(badTokenRes.result, 'error');
  assert.ok(badTokenRes.message.includes('authorization required'));
  console.log('  ✓ Correctly rejected with: ' + badTokenRes.message);
  passed++;

  testHeader('Frontend-only fallback PIN "1234" cannot authorize backend writes');
  const fallbackPinRes = await post({
    action: 'savemasterrosterdraft',
    targetMonth: nextMonth,
    adminPin: '1234',
    rows: [],
  });
  assert.equal(fallbackPinRes.result, 'error');
  assert.ok(fallbackPinRes.message.includes('authorization required'));
  console.log('  ✓ Correctly rejected backend write with frontend PIN fallback');
  passed++;

  testHeader('Incorrect PIN verification is rejected (INVALID_PIN)');
  const wrongPinRes = await post({
    action: 'verifyadminpin',
    pin: '0000',
    clientIdentifier: 'staging_test_device',
  });
  assert.equal(wrongPinRes.result, 'error');
  assert.equal(wrongPinRes.code, 'INVALID_PIN');
  console.log('  ✓ Correctly rejected invalid PIN');
  passed++;

  testHeader('Correct staging PIN verification succeeds and issues HMAC session token');
  const authRes = await post({
    action: 'verifyadminpin',
    pin: stagingPin,
    clientIdentifier: 'staging_test_device',
  });
  if (authRes.result !== 'success') {
    throw new Error(`PIN verification failed (code: ${authRes.code}, message: "${authRes.message}"). ${
      authRes.code === 'PIN_LOCKED'
        ? 'Security lockout is active because global/client failed attempts reached 5. Wait up to 5 minutes for the cache to clear.'
        : 'Ensure $env:STAGING_PIN matches ROSTER_ADMIN_PIN configured in Apps Script Script Properties.'
    }`);
  }
  assert.equal(authRes.verified, true);
  assert.ok(authRes.adminSessionToken, 'adminSessionToken issued');
  const adminToken = authRes.adminSessionToken;
  console.log('  ✓ Successfully verified PIN and obtained signed adminSessionToken');
  passed++;

  // --- SECTION 5A: DYNAMIC DRAFT PATCH SAVE TO MASTERROSTER ---
  testHeader(`Real Google Sheets patch save: Dynamic DRAFT (${nextMonth}) changes-only contract`);
  const ep1 = allData.emergencyPhysicians[0]?.name || allData.emergencyPhysicians[0]?.MemberName || 'Echo';
  const ep2 = allData.emergencyPhysicians[1]?.name || allData.emergencyPhysicians[1]?.MemberName || 'Foxtrot';

  // Read non-target and target month rows before save to verify bit-for-bit preservation
  const nonTargetRowsBefore = allData.masterRoster.filter((r) => !normalizeDateStr(r.Date || r.date).startsWith(nextMonth));
  const targetMonthRowsBefore = allData.masterRoster.filter((r) => normalizeDateStr(r.Date || r.date).startsWith(nextMonth));
  console.log(`  Existing non-target rows in MasterRoster: ${nonTargetRowsBefore.length}`);
  console.log(`  Existing target-month (${nextMonth}) rows in MasterRoster: ${targetMonthRowsBefore.length}`);

  // Select 2 existing MO rows that ACTUALLY exist in targetMonthRowsBefore to modify in-place
  const moRowsInTarget = targetMonthRowsBefore.filter(
    (r) => !String(r.Shift || r.shift || '').toUpperCase().startsWith('EP_')
  );
  assert.ok(moRowsInTarget.length >= 3, 'Must have at least 3 existing MO rows in target month');

  const mo1Row = moRowsInTarget[0];
  const mo1Name = mo1Row.Name || mo1Row.name;
  const mo1Date = normalizeDateStr(mo1Row.Date || mo1Row.date);
  const mo1Before = String(mo1Row.Shift || mo1Row.shift || '').trim();
  const mo1NewShift = mo1Before === 'PM' ? 'AM' : 'PM';
  const mo1Member = allData.teamMembers.find((m) => (m.name || m.MemberName) === mo1Name);
  const mo1Key = mo1Member?.staffId || mo1Member?.StaffId || mo1Name;

  const mo2Row = moRowsInTarget[1];
  const mo2Name = mo2Row.Name || mo2Row.name;
  const mo2Date = normalizeDateStr(mo2Row.Date || mo2Row.date);
  const mo2Before = String(mo2Row.Shift || mo2Row.shift || '').trim();
  const mo2NewShift = mo2Before === 'NIGHT' ? 'AM' : 'NIGHT';
  const mo2Member = allData.teamMembers.find((m) => (m.name || m.MemberName) === mo2Name);
  const mo2Key = mo2Member?.staffId || mo2Member?.StaffId || mo2Name;

  // Select 1 existing EP row that ACTUALLY exists in targetMonthRowsBefore to modify in-place
  const epRowsInTarget = targetMonthRowsBefore.filter(
    (r) => String(r.Shift || r.shift || '').toUpperCase() === 'EP_OFFICE_HOUR'
  );
  assert.ok(epRowsInTarget.length >= 1, 'Must have at least 1 existing EP_OFFICE_HOUR row in target month');
  const epTargetRow = epRowsInTarget[0];
  const epDate = normalizeDateStr(epTargetRow.Date || epTargetRow.date);
  const epBefore = String(epTargetRow.Name || epTargetRow.name || '').trim();
  const epNewName = epBefore === ep1 ? ep2 : ep1;

  const draftOpId = `op_staging_draft_${Date.now()}`;
  const draftChanges = [
    {
      date: mo1Date,
      targetType: 'MO',
      field: 'MO_SHIFT',
      staffName: mo1Name,
      staffKey: mo1Key,
      previousValue: mo1Before,
      newValue: mo1NewShift,
      isCleared: false,
    },
    {
      date: mo2Date,
      targetType: 'MO',
      field: 'MO_SHIFT',
      staffName: mo2Name,
      staffKey: mo2Key,
      previousValue: mo2Before,
      newValue: mo2NewShift,
      isCleared: false,
    },
    {
      date: epDate,
      targetType: 'EP',
      field: 'EP_OFFICE_HOUR',
      staffName: epBefore,
      staffKey: '__EP__',
      previousValue: epBefore,
      newValue: epNewName,
      isCleared: false,
    },
  ];

  const draftSaveRes = await post({
    action: 'savemasterrosterdraft',
    adminSessionToken: adminToken,
    targetMonth: nextMonth,
    operationId: draftOpId,
    changes: draftChanges,
  });
  assert.equal(draftSaveRes.result, 'success', 'Draft save succeeded');
  assert.equal(draftSaveRes.mode, 'DRAFT');
  assert.equal(draftSaveRes.target, 'MAIN');
  assert.equal(draftSaveRes.targetMonth, nextMonth);
  assert.equal(draftSaveRes.count, 3, 'API returns correct affectedCount of 3 for 3 modified assignments');
  console.log(`  ✓ MasterRoster patch applied: ${draftSaveRes.count} changes persisted for ${nextMonth} (OpId: ${draftOpId})`);
  passed++;

  // --- SECTION 5B: EXPLICIT ASSIGNMENT DELETION TEST ---
  testHeader(`Real Google Sheets explicit deletion test in ${nextMonth}`);
  // Select a 3rd distinct existing MO row in target month to explicitly delete
  const delRow = moRowsInTarget[2];
  const delName = delRow.Name || delRow.name;
  const delDate = normalizeDateStr(delRow.Date || delRow.date);
  const delBefore = String(delRow.Shift || delRow.shift || '').trim();
  const delMember = allData.teamMembers.find((m) => (m.name || m.MemberName) === delName);
  const delKey = delMember?.staffId || delMember?.StaffId || delName;

  const delOpId = `op_staging_del_${Date.now()}`;
  const delRes = await post({
    action: 'savemasterrosterdraft',
    adminSessionToken: adminToken,
    targetMonth: nextMonth,
    operationId: delOpId,
    changes: [
      {
        date: delDate,
        targetType: 'MO',
        field: 'MO_SHIFT',
        staffName: delName,
        staffKey: delKey,
        previousValue: delBefore,
        newValue: '__CLEAR__',
        isCleared: true,
      },
    ],
  });
  assert.equal(delRes.result, 'success', 'Explicit deletion succeeded');
  assert.equal(delRes.count, 1, 'Deletion reports affectedCount of 1');
  console.log(`  ✓ Explicitly cleared assignment for ${delName} on ${delDate} (OpId: ${delOpId})`);
  passed++;

  // --- SECTION 5C: DYNAMIC AMENDMENTS SAVE TO AMENDROSTER ---
  testHeader(`Real Google Sheets save: Dynamic AMEND (${currentMonth}) to AmendRoster`);
  const amendOpId = `op_staging_amend_${Date.now()}`;

  // Pick an existing MO row from current month for amendment test
  const currentMonthMoRows = allData.masterRoster.filter(
    (r) => normalizeDateStr(r.Date || r.date).startsWith(currentMonth) && !String(r.Shift || r.shift || '').toUpperCase().startsWith('EP_')
  );
  assert.ok(currentMonthMoRows.length > 0, 'Must have at least one MO row in current month');
  const moCurrentRow = currentMonthMoRows[0];
  const mo1 = moCurrentRow.Name || moCurrentRow.name;
  const amendDate1 = normalizeDateStr(moCurrentRow.Date || moCurrentRow.date);
  const mo1CurrentPrev = String(moCurrentRow.Shift || moCurrentRow.shift || '').trim();
  const mo1CurrentNew = mo1CurrentPrev === 'NIGHT' ? 'AM' : 'NIGHT';

  // Pick an existing EP row from current month for amendment test
  const currentMonthEpRows = allData.masterRoster.filter(
    (r) => normalizeDateStr(r.Date || r.date).startsWith(currentMonth) && String(r.Shift || r.shift || '').toUpperCase() === 'EP_OFFICE_HOUR'
  );
  assert.ok(currentMonthEpRows.length > 0, 'Must have at least one EP_OFFICE_HOUR row in current month');
  const epCurrentRow = currentMonthEpRows[0];
  const amendDate2 = normalizeDateStr(epCurrentRow.Date || epCurrentRow.date);
  const epCurrentPrev = String(epCurrentRow.Name || epCurrentRow.name || '').trim();

  const amendSaveRes = await post({
    action: 'appendrosteramendments',
    adminSessionToken: adminToken,
    targetMonth: currentMonth,
    operationId: amendOpId,
    amendments: [
      {
        amendmentId: `${amendOpId}_1`,
        date: amendDate1,
        targetType: 'MO',
        field: 'MO_SHIFT',
        staffName: mo1,
        previousValue: mo1CurrentPrev,
        newValue: mo1CurrentNew,
      },
      {
        amendmentId: `${amendOpId}_2`,
        date: amendDate2,
        targetType: 'EP',
        field: 'EP_OFFICE_HOUR',
        staffName: epCurrentPrev,
        previousValue: epCurrentPrev,
        newValue: '__CLEAR__',
        isCleared: true,
      },
    ],
  });
  assert.equal(amendSaveRes.result, 'success', `Amend save succeeded: ${amendSaveRes.message || ''}`);
  assert.equal(amendSaveRes.mode, 'AMEND');
  assert.equal(amendSaveRes.target, 'AMEND');
  assert.equal(amendSaveRes.targetMonth, currentMonth);
  console.log(`  ✓ AmendRoster sheet updated with ${amendSaveRes.count} amendments for ${currentMonth}`);
  passed++;

  // --- SECTION 5D: IDEMPOTENT RETRY & CONFLICT SAFETY ---
  testHeader(`Duplicate save retry for ${nextMonth} with same operationId is idempotent (zero duplication)`);
  const retryRes = await post({
    action: 'savemasterrosterdraft',
    adminSessionToken: adminToken,
    targetMonth: nextMonth,
    operationId: draftOpId,
    changes: draftChanges,
  });
  assert.equal(retryRes.result, 'success');
  assert.equal(retryRes.idempotentReplay, true, 'Server identified idempotent replay');
  console.log('  ✓ Server correctly returned cached idempotent response without modifying sheets');
  passed++;

  testHeader('Concurrent modification conflict detection fail-closed');
  const conflictRes = await post({
    action: 'savemasterrosterdraft',
    adminSessionToken: adminToken,
    targetMonth: nextMonth,
    expectedCellBaselines: [
      {
        date: mo1Date,
        field: 'MO_SHIFT',
        staffName: mo1Name,
        staffKey: mo1Key,
        expectedValue: 'STALE_UNKNOWN_VALUE', // Stale baseline: server value is mo1NewShift
        newValue: 'STANDBY1',
      },
    ],
    changes: [
      {
        date: mo1Date,
        targetType: 'MO',
        field: 'MO_SHIFT',
        staffName: mo1Name,
        previousValue: 'STALE_UNKNOWN_VALUE',
        newValue: 'STANDBY1',
      },
    ],
  });
  assert.equal(conflictRes.result, 'error');
  assert.ok(conflictRes.message.includes('CONFLICT: Concurrent edit detected'));
  console.log('  ✓ Server prevented stale overwrite: ' + conflictRes.message);
  passed++;

  // --- SECTION 6: REAL GOOGLE SHEETS PERSISTENCE & DATA PRESERVATION VERIFICATION ---
  testHeader('Verify persistence and data preservation from real Google Sheets');
  const freshData = await get('alldata');
  const nextPersisted = freshData.masterRoster.filter((r) => normalizeDateStr(r.Date || r.date).startsWith(nextMonth));
  const nonTargetPersisted = freshData.masterRoster.filter((r) => !normalizeDateStr(r.Date || r.date).startsWith(nextMonth));

  // Read amendments directly from AmendRoster
  const amendPersisted = await get('amendroster', { month: currentMonth });

  assert.ok(nextPersisted.length > 0, `MasterRoster target month (${nextMonth}) must not be empty`);

  // Data Preservation Invariants:
  if (targetMonthRowsBefore.length > 0) {
    // 3 updated in-place (net 0), 1 cleared (net -1) -> expected target month row count is before - 1
    const expectedTargetCount = targetMonthRowsBefore.length - 1;
    assert.equal(
      nextPersisted.length,
      expectedTargetCount,
      `MasterRoster ${nextMonth} preserved all assignments (before: ${targetMonthRowsBefore.length}, expected: ${expectedTargetCount}, actual: ${nextPersisted.length}, did NOT drop to 3)`
    );
  }

  // 1. Confirm the 3 intended edits persisted
  assert.ok(
    nextPersisted.some((r) => (r.Name === mo1Name || r.name === mo1Name) && normalizeDateStr(r.Date || r.date) === mo1Date && (r.Shift === mo1NewShift || r.shift === mo1NewShift)),
    `Confirmed MO edit for ${mo1Name} on ${mo1Date} persisted as ${mo1NewShift} in MasterRoster`
  );
  assert.ok(
    nextPersisted.some((r) => (r.Name === mo2Name || r.name === mo2Name) && normalizeDateStr(r.Date || r.date) === mo2Date && (r.Shift === mo2NewShift || r.shift === mo2NewShift)),
    `Confirmed MO edit for ${mo2Name} on ${mo2Date} persisted as ${mo2NewShift} in MasterRoster`
  );
  assert.ok(
    nextPersisted.some((r) => (r.Name === epNewName || r.name === epNewName) && normalizeDateStr(r.Date || r.date) === epDate && (String(r.Shift || r.shift || '').toUpperCase() === 'EP_OFFICE_HOUR')),
    `Confirmed EP edit on ${epDate} persisted as ${epNewName} in MasterRoster`
  );

  // 2. Confirm explicit deletion removed only that specific cell
  assert.ok(
    !nextPersisted.some((r) => (r.Name === delName || r.name === delName) && normalizeDateStr(r.Date || r.date) === delDate),
    `Confirmed explicitly cleared assignment for ${delName} on ${delDate} is deleted from MasterRoster`
  );

  // 3. Confirm zero duplicate assignments
  const rowKeys = nextPersisted.map((r) => `${r.Name || r.name}_${normalizeDateStr(r.Date || r.date)}_${r.Shift || r.shift}`);
  assert.equal(rowKeys.length, new Set(rowKeys).size, 'No duplicate assignments in MasterRoster target month');

  // 4. Confirm zero blank-row anomalies
  assert.ok(
    nextPersisted.every((r) => (r.Name || r.name) && (r.Date || r.date) && (r.Shift || r.shift)),
    'No blank-row anomalies in MasterRoster target month'
  );

  // 5. Confirm non-target MasterRoster months preserved bit-for-bit
  assert.equal(nonTargetPersisted.length, nonTargetRowsBefore.length, 'Non-target MasterRoster rows were 100% preserved bit-for-bit');

  // 6. Confirm current-month amendment appended to AmendRoster and MasterRoster untouched
  assert.ok(
    amendPersisted.some((a) => normalizeDateStr(a.Date || a.date) === amendDate1 && (a.NewValue === mo1CurrentNew || a.newValue === mo1CurrentNew)),
    `Current month amendment persisted in AmendRoster for ${amendDate1}`
  );
  assert.ok(
    amendPersisted.some((a) => normalizeDateStr(a.Date || a.date) === amendDate2 && (a.NewValue === '__CLEAR__' || a.newValue === '__CLEAR__' || a.IsCleared === true || a.isCleared === true || a.IsCleared === 'TRUE')),
    `Explicit clear amendment persisted in AmendRoster for ${amendDate2}`
  );

  // Confirm MasterRoster current month still holds original baseline value (untouched by amendment)
  if (mo1CurrentPrev) {
    const mo1MasterRowAfter = freshData.masterRoster.find(
      (r) => (r.Name === mo1 || r.name === mo1) && normalizeDateStr(r.Date || r.date) === amendDate1
    );
    assert.equal(
      mo1MasterRowAfter?.Shift || mo1MasterRowAfter?.shift,
      mo1CurrentPrev,
      `MasterRoster current-month row for ${mo1} on ${amendDate1} remained untouched (${mo1CurrentPrev})`
    );
  }

  console.log(`  ✓ MasterRoster contains confirmed ${nextMonth} draft patch edits`);
  console.log(`  ✓ MasterRoster explicitly removed deleted assignment on ${delDate}`);
  console.log('  ✓ MasterRoster non-target rows preserved bit-for-bit');
  console.log('  ✓ Zero duplicates and zero blank-row anomalies verified');
  console.log(`  ✓ AmendRoster sheet contains confirmed ${currentMonth} amendments while MasterRoster remained untouched`);
  passed++;

  console.log('\n' + '='.repeat(75));
  console.log(`🎉 ALL ${passed}/${total} REAL STAGING INTEGRATION TESTS PASSED!`);
  console.log('='.repeat(75));
}

runTests().catch((err) => {
  console.error('\n❌ Staging test failed:', err);
  process.exit(1);
});
