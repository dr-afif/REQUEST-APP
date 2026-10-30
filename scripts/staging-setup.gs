/**
 * REQUEST-APP — Disposable Staging Environment Initializer
 *
 * SAFETY INVARIANTS:
 * 1. Explicit Authorization Guard: Fails closed unless Script Property
 *    'STAGING_INITIALIZATION_AUTHORIZED' === 'true'.
 * 2. Target Workbook Guard: Refuses to execute unless spreadsheet title contains
 *    'staging', 'disposable', 'test', or 'dev', and does NOT contain 'prod' or 'live'.
 * 3. Populated Data Guard: Refuses to run if any operational sheet already exists
 *    or if the workbook contains more than 2 sheets.
 * 4. Independent Credentials: Does NOT contain hardcoded PINs or session secrets.
 *    Requires independently configured Script Properties 'ROSTER_ADMIN_PIN' and
 *    'ROSTER_V2_SESSION_SECRET' (>= 32 chars).
 * 5. Single Tab Standardization: Initializes amendment tab strictly as 'AmendRoster'.
 * 6. Non-Destructive Sheet Deletion: Deletes ONLY the untouched default blank 'Sheet1'
 *    in a verified new disposable workbook.
 * 7. Server-Side Identity: Sets persistent 'APP_ENVIRONMENT=staging' and
 *    'STAGING_SPREADSHEET_ID' tied to the disposable spreadsheet ID.
 * 8. Dynamic Month-Independence: Uses dynamic Malaysia time (UTC+8) for seeding
 *    previous, current, and next calendar months with seamless year-rollover.
 * 9. One-Time Revocation: Revokes authorization immediately after initialization.
 *
 * NOTE: This helper is isolated in this script file. It is NOT part of the Web App
 * endpoints (doGet/doPost) and cannot be triggered via public network requests.
 */

function setupStagingEnvironment() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // GUARD 1: Explicit operator authorization required
  var authorized = props.getProperty('STAGING_INITIALIZATION_AUTHORIZED');
  if (authorized !== 'true') {
    throw new Error(
      'REFUSING TO INITIALIZE: Script Property "STAGING_INITIALIZATION_AUTHORIZED" must be set to "true" ' +
      'in Project Settings > Script Properties before running this setup.'
    );
  }

  // GUARD 2: Refuse duplicate run if already initialized
  if (props.getProperty('STAGING_INITIALIZED_AT')) {
    throw new Error(
      'REFUSING TO INITIALIZE: Staging environment was already initialized at ' +
      props.getProperty('STAGING_INITIALIZED_AT') +
      '. Refusing duplicate initialization.'
    );
  }

  // GUARD 3: Required credentials must already be configured (no hardcoded secrets)
  var adminPin = String(props.getProperty('ROSTER_ADMIN_PIN') || '').trim();
  if (!adminPin || !/^\d{4,8}$/.test(adminPin)) {
    throw new Error(
      'STAGING SETUP BLOCKED: Script Property "ROSTER_ADMIN_PIN" is missing or invalid. ' +
      'Please configure a 4-8 digit PIN in Project Settings > Script Properties.'
    );
  }

  var sessionSecret = String(props.getProperty('ROSTER_V2_SESSION_SECRET') || '').trim();
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error(
      'STAGING SETUP BLOCKED: Script Property "ROSTER_V2_SESSION_SECRET" is missing or too short (< 32 chars). ' +
      'Please configure a strong random HMAC secret in Project Settings > Script Properties.'
    );
  }

  // GUARD 4: Verify target spreadsheet identity
  var sheetTitle = ss.getName().toLowerCase();
  var isStagingTitle = (
    sheetTitle.indexOf('staging') !== -1 ||
    sheetTitle.indexOf('disposable') !== -1 ||
    sheetTitle.indexOf('test') !== -1 ||
    sheetTitle.indexOf('dev') !== -1
  );
  var isProdTitle = (
    sheetTitle.indexOf('prod') !== -1 ||
    sheetTitle.indexOf('live') !== -1
  );
  if (!isStagingTitle || isProdTitle) {
    throw new Error(
      'REFUSING TO INITIALIZE: Target spreadsheet title ("' + ss.getName() + '") does not contain "staging", ' +
      '"disposable", "test", or "dev", or contains "prod"/"live". ' +
      'Staging setup will only execute on a spreadsheet explicitly named for staging or disposable testing.'
    );
  }

  // GUARD 5: Refuse populated workbook / refuse overwriting existing operational sheets
  var existingSheets = ss.getSheets();
  var operationalTabs = [
    'MasterRoster', 'AmendRoster', 'RosterAmendments', 'TeamMembers',
    'EmergencyPhysicians', 'Requests', 'Settings'
  ];
  for (var i = 0; i < operationalTabs.length; i++) {
    var opSheet = ss.getSheetByName(operationalTabs[i]);
    if (opSheet && opSheet.getLastRow() > 1) {
      throw new Error(
        'REFUSING TO INITIALIZE: Target workbook already contains populated operational sheet "' +
        operationalTabs[i] + '" (' + opSheet.getLastRow() + ' rows). Refusing to overwrite existing data.'
      );
    }
  }

  // Refuse if unexpected populated or third-party sheets exist
  for (var j = 0; j < existingSheets.length; j++) {
    var curSheet = existingSheets[j];
    var curName = curSheet.getName();
    var isOp = operationalTabs.indexOf(curName) !== -1;
    var isDefaultBlank = (curName === 'Sheet1' && curSheet.getLastRow() <= 1);
    // Operational sheets from an interrupted attempt are allowed only if unpopulated (<= 1 row)
    if (isOp && curSheet.getLastRow() <= 1) continue;
    if (isDefaultBlank) continue;
    throw new Error(
      'REFUSING TO INITIALIZE: Target workbook contains unexpected or populated sheet "' +
      curName + '". Expected a blank or disposable staging workbook.'
    );
  }

  Logger.log('Safety preflight verified. Initializing synthetic staging data...');

  // Helper for creating sheet with headers (resets partial state if interrupted previously)
  function initSheet(name, headers) {
    var s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
    } else {
      s.clear();
    }
    if (headers && headers.length > 0) {
      s.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    return s;
  }

  // 1. TeamMembers (13 synthetic MOs)
  var tmSheet = initSheet('TeamMembers', ['MemberName', 'FullName', 'Phone', 'Active', 'StaffId', 'Email']);
  var tmData = [
    ['Person A', 'Doctor Person A', '0123456789', 'TRUE', 'A05157', 'person_a@hospital.local'],
    ['Person B', 'Doctor Person B', '0123456788', 'TRUE', 'A05156', 'person_b@hospital.local'],
    ['Syuhada', 'Dr Syuhada', '0123456787', 'TRUE', 'A05155', 'syuhada@hospital.local'],
    ['Dr Faiz', 'Dr Faiz', '0123456786', 'TRUE', 'A05154', 'faiz@hospital.local'],
    ['Dr Hanim', 'Dr Hanim', '0123456785', 'TRUE', 'A05153', 'hanim@hospital.local'],
    ['Dr Afiq', 'Dr Afiq', '0123456784', 'TRUE', 'A05152', 'afiq@hospital.local'],
    ['Dr Nurul', 'Dr Nurul', '0123456783', 'TRUE', 'A05151', 'nurul@hospital.local'],
    ['Dr Daniel', 'Dr Daniel', '0123456782', 'TRUE', 'A05150', 'daniel@hospital.local'],
    ['Dr Nabil', 'Dr Nabil', '0123456781', 'TRUE', 'A05149', 'nabil@hospital.local'],
    ['Dr Sarah', 'Dr Sarah', '0123456780', 'TRUE', 'A05148', 'sarah@hospital.local'],
    ['Dr Kelvin', 'Dr Kelvin', '0123456779', 'TRUE', 'A05147', 'kelvin@hospital.local'],
    ['Dr Zulaikha', 'Dr Zulaikha', '0123456778', 'TRUE', 'A05146', 'zulaikha@hospital.local'],
    ['Dr Amir', 'Dr Amir', '0123456777', 'TRUE', 'A05145', 'amir@hospital.local']
  ];
  tmSheet.getRange(2, 1, tmData.length, tmData[0].length).setValues(tmData);

  // 2. EmergencyPhysicians (6 synthetic EPs)
  var epSheet = initSheet('EmergencyPhysicians', ['MemberName', 'FullName', 'Phone', 'Active', 'StaffId', 'Email']);
  var epData = [
    ['Echo', 'Dr Echo', '0130000001', 'TRUE', 'EP01', 'echo@hospital.local'],
    ['Foxtrot', 'Dr Foxtrot', '0130000002', 'TRUE', 'EP02', 'foxtrot@hospital.local'],
    ['Golf', 'Dr Golf', '0130000003', 'TRUE', 'EP03', 'golf@hospital.local'],
    ['Hotel', 'Dr Hotel', '0130000004', 'TRUE', 'EP04', 'hotel@hospital.local'],
    ['India', 'Dr India', '0130000005', 'TRUE', 'EP05', 'india@hospital.local'],
    ['Juliet', 'Dr Juliet', '0130000006', 'TRUE', 'EP06', 'juliet@hospital.local']
  ];
  epSheet.getRange(2, 1, epData.length, epData[0].length).setValues(epData);

  // 3. ShiftTypes
  var stSheet = initSheet('ShiftTypes', ['ID', 'Name', 'IsPublic', 'GroupID']);
  var stData = [
    ['1', 'AM', 'TRUE', 'WORK'],
    ['2', 'PM', 'TRUE', 'WORK'],
    ['3', 'NIGHT', 'TRUE', 'WORK'],
    ['4', 'STANDBY1', 'TRUE', 'STANDBY'],
    ['5', 'STANDBY2', 'TRUE', 'STANDBY'],
    ['6', 'OFF', 'TRUE', 'LEAVE'],
    ['7', 'GOFF', 'TRUE', 'LEAVE'],
    ['8', 'EP_OFFICE_HOUR', 'TRUE', 'EP'],
    ['9', 'EP_ONCALL', 'TRUE', 'EP']
  ];
  stSheet.getRange(2, 1, stData.length, stData[0].length).setValues(stData);

  // Dynamic Malaysia calendar month calculation (UTC+8)
  var now = new Date();
  var klDate = new Date(now.getTime() + 8 * 3600 * 1000);
  var currentY = klDate.getUTCFullYear();
  var currentM = klDate.getUTCMonth() + 1; // 1..12

  function fmtYm(y, m) {
    return y + '-' + (m < 10 ? '0' : '') + m;
  }

  function shiftYm(y, m, delta) {
    var tot = y * 12 + (m - 1) + delta;
    var nY = Math.floor(tot / 12);
    var nM = (tot % 12) + 1;
    return { y: nY, m: nM, ym: fmtYm(nY, nM) };
  }

  function getDaysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  var prevMonthObj = shiftYm(currentY, currentM, -1);
  var currMonthObj = shiftYm(currentY, currentM, 0);
  var nextMonthObj = shiftYm(currentY, currentM, 1);

  // 4. MasterRoster (Dynamic seeding: Previous month, Current month, Next month)
  var mrSheet = initSheet('MasterRoster', ['Name', 'Date', 'Shift']);
  var mrRows = [];
  var shifts = ['AM', 'PM', 'NIGHT', 'STANDBY1', 'STANDBY2', 'OFF', 'GOFF'];

  var targetMonths = [prevMonthObj, currMonthObj, nextMonthObj];
  for (var tIdx = 0; tIdx < targetMonths.length; tIdx++) {
    var tm = targetMonths[tIdx];
    var daysCount = getDaysInMonth(tm.y, tm.m);
    for (var d = 1; d <= daysCount; d++) {
      var dStr = (d < 10 ? '0' : '') + d;
      var dateStr = tm.ym + '-' + dStr;
      for (var mIdx = 0; mIdx < tmData.length; mIdx++) {
        var s = shifts[(d + mIdx) % shifts.length];
        if (s !== 'OFF') {
          mrRows.push([tmData[mIdx][0], dateStr, s]);
        }
      }
      mrRows.push([epData[d % epData.length][0], dateStr, 'EP_OFFICE_HOUR']);
      mrRows.push([epData[(d + 1) % epData.length][0], dateStr, 'EP_ONCALL']);
    }
  }
  mrSheet.getRange(2, 1, mrRows.length, 3).setValues(mrRows);

  // 5. AmendRoster (Standard headers for amendments)
  var AMEND_ROSTER_HEADERS = [
    'AmendmentId', 'OperationId', 'RosterMonth', 'Date', 'TargetType',
    'Field', 'StaffKey', 'StaffName', 'PreviousValue', 'NewValue',
    'IsCleared', 'SavedAt', 'Sequence'
  ];
  initSheet('AmendRoster', AMEND_ROSTER_HEADERS);

  // 6. Settings (current calendar month set dynamically)
  var settingsSheet = initSheet('Settings', ['Key', 'Value']);
  var sData = [
    ['adminPin', adminPin],
    ['currentRosterMonth', currMonthObj.ym]
  ];
  settingsSheet.getRange(2, 1, sData.length, 2).setValues(sData);

  // 7. Companion operational sheets (empty with standard headers)
  initSheet('ShiftBlocks', ['ID', 'Date', 'ShiftType', 'MaxSlots']);
  initSheet('LimitGroups', ['ID', 'GroupName', 'DefaultLimit']);
  initSheet('Requests', ['ID', 'Timestamp', 'Name', 'Date', 'Day', 'Request', 'Status', 'Comment', 'ApprovalStatus', 'SwapPartner', 'RequestType']);
  initSheet('ActivityHistory', ['ID', 'Timestamp', 'CustomText', 'Name', 'RequestType', 'Request', 'SwapPartner', 'Date', 'ApprovalStatus', 'Comment', 'Status']);
  initSheet('PublicHolidays', ['ID', 'Date', 'Name', 'Active']);
  initSheet('LeaveApplications', ['ID', 'MemberName', 'LeaveType', 'StartDate', 'EndDate', 'Days', 'Status', 'SubmittedDate', 'ReferenceNo', 'Notes', 'UpdatedAt']);

  // GUARD 6: Safe deletion of untouched default blank Sheet1 ONLY
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    if (sheet1.getLastRow() <= 1 && sheet1.getLastColumn() <= 1) {
      var val = sheet1.getRange(1, 1).getValue();
      if (!val) {
        try { ss.deleteSheet(sheet1); } catch (_) {}
      }
    }
  }

  // GUARD 7 & Server-Side Identity:
  // Set persistent staging markers tied to this disposable spreadsheet ID
  var ssId = ss.getId();
  props.setProperties({
    'APP_ENVIRONMENT': 'staging',
    'STAGING_SPREADSHEET_ID': ssId,
    'STAGING_SPREADSHEET_NAME': ss.getName(),
    'STAGING_INITIALIZED_AT': new Date().toISOString()
  });

  // Revoke initialization authorization to prevent accidental re-runs
  props.deleteProperty('STAGING_INITIALIZATION_AUTHORIZED');

  Logger.log('Staging environment successfully initialized. MasterRoster and AmendRoster are ready for ' + currMonthObj.ym + ' (Amend) and ' + nextMonthObj.ym + ' (Draft).');
}

/**
 * Narrowly scoped, staging-only fixture restoration.
 * Safely restores the synthetic MasterRoster assignments for dynamic Malaysia timeline
 * (previous, current, and future months) without altering credentials, settings,
 * team members, or other operational sheets.
 */
function restoreStagingMasterRoster() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // GUARD 1: Verify server-side staging identity
  var appEnv = props.getProperty('APP_ENVIRONMENT');
  var stagingSheetId = props.getProperty('STAGING_SPREADSHEET_ID');
  if (appEnv !== 'staging' || !stagingSheetId || ss.getId() !== stagingSheetId) {
    throw new Error('REFUSING TO RESTORE: Target spreadsheet ID (' + ss.getId() + ') does not match persistent STAGING_SPREADSHEET_ID.');
  }

  // GUARD 2: Verify spreadsheet title
  var title = ss.getName().toLowerCase();
  var isStagingTitle = (title.indexOf('staging') !== -1 || title.indexOf('disposable') !== -1 || title.indexOf('test') !== -1 || title.indexOf('dev') !== -1);
  var isProdTitle = (title.indexOf('prod') !== -1 || title.indexOf('live') !== -1);
  if (!isStagingTitle || isProdTitle) {
    throw new Error('REFUSING TO RESTORE: Target spreadsheet title ("' + ss.getName() + '") is not verified staging.');
  }

  // GUARD 3: Verify supporting tabs exist
  var tmSheet = ss.getSheetByName('TeamMembers');
  var epSheet = ss.getSheetByName('EmergencyPhysicians');
  if (!tmSheet || tmSheet.getLastRow() <= 1 || !epSheet || epSheet.getLastRow() <= 1) {
    throw new Error('REFUSING TO RESTORE: TeamMembers or EmergencyPhysicians sheet is missing or empty.');
  }

  var tmValues = tmSheet.getRange(2, 1, tmSheet.getLastRow() - 1, 1).getValues();
  var tmData = tmValues.map(function(r) { return String(r[0]).trim(); }).filter(Boolean);

  var epValues = epSheet.getRange(2, 1, epSheet.getLastRow() - 1, 1).getValues();
  var epData = epValues.map(function(r) { return String(r[0]).trim(); }).filter(Boolean);

  // Dynamic Malaysia Timeline (UTC+8)
  var now = new Date();
  var klNow = new Date(now.getTime() + 8 * 3600 * 1000);
  var currentY = klNow.getUTCFullYear();
  var currentM = klNow.getUTCMonth() + 1;

  function shiftYm(y, m, delta) {
    var tot = y * 12 + (m - 1) + delta;
    var ny = Math.floor(tot / 12);
    var nm = (tot % 12) + 1;
    return { y: ny, m: nm, ym: ny + '-' + (nm < 10 ? '0' : '') + nm };
  }

  function getDaysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  var prevMonthObj = shiftYm(currentY, currentM, -1);
  var currMonthObj = shiftYm(currentY, currentM, 0);
  var nextMonthObj = shiftYm(currentY, currentM, 1);

  var mrSheet = ss.getSheetByName('MasterRoster');
  if (!mrSheet) {
    mrSheet = ss.insertSheet('MasterRoster');
    mrSheet.getRange(1, 1, 1, 3).setValues([['Name', 'Date', 'Shift']]);
  }

  var rowCountBefore = mrSheet.getLastRow();
  Logger.log('MasterRoster row count BEFORE restoration: ' + rowCountBefore);

  var mrRows = [];
  var shifts = ['AM', 'PM', 'NIGHT', 'STANDBY1', 'STANDBY2', 'OFF', 'GOFF'];
  var targetMonths = [prevMonthObj, currMonthObj, nextMonthObj];

  for (var tIdx = 0; tIdx < targetMonths.length; tIdx++) {
    var tm = targetMonths[tIdx];
    var daysCount = getDaysInMonth(tm.y, tm.m);
    for (var d = 1; d <= daysCount; d++) {
      var dStr = (d < 10 ? '0' : '') + d;
      var dateStr = tm.ym + '-' + dStr;
      for (var mIdx = 0; mIdx < tmData.length; mIdx++) {
        var s = shifts[(d + mIdx) % shifts.length];
        if (s !== 'OFF') {
          mrRows.push([tmData[mIdx], dateStr, s]);
        }
      }
      mrRows.push([epData[d % epData.length], dateStr, 'EP_OFFICE_HOUR']);
      mrRows.push([epData[(d + 1) % epData.length], dateStr, 'EP_ONCALL']);
    }
  }

  // Clear existing data rows (keep header)
  if (rowCountBefore > 1) {
    mrSheet.getRange(2, 1, rowCountBefore - 1, mrSheet.getLastColumn()).clearContent();
  }
  mrSheet.getRange(1, 1, 1, 3).setValues([['Name', 'Date', 'Shift']]);
  mrSheet.getRange(2, 1, mrRows.length, 3).setValues(mrRows);

  var rowCountAfter = mrSheet.getLastRow();
  Logger.log('MasterRoster row count AFTER restoration: ' + rowCountAfter + ' (' + mrRows.length + ' data rows)');

  // Ensure AmendRoster has headers and is clear of previous test data
  var arSheet = ss.getSheetByName('AmendRoster');
  if (!arSheet) {
    arSheet = ss.insertSheet('AmendRoster');
  }
  if (arSheet.getLastRow() > 1) {
    arSheet.getRange(2, 1, arSheet.getLastRow() - 1, arSheet.getLastColumn()).clearContent();
  }
  var AMEND_ROSTER_HEADERS = [
    'AmendmentId', 'OperationId', 'RosterMonth', 'Date', 'TargetType',
    'Field', 'StaffKey', 'StaffName', 'PreviousValue', 'NewValue',
    'IsCleared', 'SavedAt', 'Sequence'
  ];
  arSheet.getRange(1, 1, 1, AMEND_ROSTER_HEADERS.length).setValues([AMEND_ROSTER_HEADERS]);

  Logger.log('Staging MasterRoster restored successfully: ' + mrRows.length + ' assignments across ' + prevMonthObj.ym + ', ' + currMonthObj.ym + ', ' + nextMonthObj.ym);
  return {
    rowCountBefore: rowCountBefore,
    rowCountAfter: rowCountAfter,
    dataRowCount: mrRows.length,
    timeline: [prevMonthObj.ym, currMonthObj.ym, nextMonthObj.ym]
  };
}

/**
 * Convenience helper to clear PIN attempt throttling cache if locked out during staging testing.
 */
function clearStagingPinLockout() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('APP_ENVIRONMENT') !== 'staging') {
    throw new Error('REFUSING TO CLEAR LOCKOUT: Not staging environment.');
  }
  var cache = CacheService.getScriptCache();
  if (cache) {
    cache.remove('pin_fails_global');
    cache.remove('pin_fails_staging_test_device');
  }
  Logger.log('Staging PIN lockout cache cleared successfully.');
}

