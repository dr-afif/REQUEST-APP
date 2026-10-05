// Apps Script I/O boundary. Reads below never call legacy getters/bootstrap helpers.
function rosterV2ReadTable_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return { headers: [], rows: [], exists: false };
  const values = sheet.getDataRange().getValues();
  return { headers: values[0] || [], rows: values.slice(1), exists: true };
}

function rosterV2Records_(table, requiredHeaders, preserveBlankRows) {
  if (!table.exists) return [];
  requiredHeaders.forEach(function(header) {
    if (table.headers.filter(function(h) { return h === header; }).length !== 1) throw new Error('Ambiguous or missing v2 source header: ' + header);
  });
  return table.rows.filter(function(row) { return preserveBlankRows || row.some(function(v) { return v !== '' && v !== null; }); }).map(function(row) {
    const record = {};
    requiredHeaders.forEach(function(header) { record[header] = row[table.headers.indexOf(header)]; });
    return record;
  });
}

function rosterV2Settings_() {
  const table = rosterV2ReadTable_('Settings');
  const settings = {};
  if (!table.exists) return settings;
  // Match the legacy positional key/value contract, but return only reserved switch values.
  table.rows.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (RosterCompatibility.isReservedSetting(key)) settings[key] = String(row[1] || '').trim();
  });
  return settings;
}

function rosterV2Schema_() {
  const headers = {};
  Object.keys(RosterCompatibility.schemas).forEach(function(name) {
    const table = rosterV2ReadTable_(name);
    if (table.exists) headers[name] = table.headers;
  });
  return { schemaVersion: 2, foundationVersion: 1, semanticRuleVersion: 1,
    timezone: 'Asia/Kuala_Lumpur', capabilities: { discovery: true, shadowPeriodRead: true,
      officialWrites: false, privateNotes: false, automaticEnrollment: false },
    featureDefaults: RosterCompatibility.featureDefaults,
    configuredFeatures: RosterCompatibility.featureSwitches(rosterV2Settings_()),
    // Keep the Phase 1 discovery contract stable. Phase 2 draft capability discovery is private.
    effectiveFeatures: RosterCompatibility.featureDefaults,
    legacyUploadPolicy: 'Allowed only while no RosterPeriods enrollment exists',
    schemas: RosterCompatibility.schemaPlan(headers), catalog: RosterCompatibility.catalog,
    staffingDefaults: RosterCompatibility.staffingDefaults };
}

function rosterV2Directory_(name) {
  const table = rosterV2ReadTable_(name);
  if (!table.exists) return [];
  const fields = ['MemberName'];
  if (table.headers.indexOf('Active') >= 0) fields.push('Active');
  return rosterV2Records_(table, fields);
}

function rosterV2Period_(parameters) {
  const periodId = RosterCompatibility.validatePeriod(String(parameters.period || ''));
  if (parameters.mode !== 'shadow') throw new Error('Phase 1 period reads require mode=shadow; official v2 reads are disabled.');
  const rosterTable = rosterV2ReadTable_('MasterRoster');
  const rows = rosterV2Records_(rosterTable, ['Name', 'Date', 'Shift'], true);
  const people = rosterV2Records_(rosterV2ReadTable_('RosterPeople'), ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active']);
  const periods = rosterV2Records_(rosterV2ReadTable_('RosterPeriods'), ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy']);
  const resolvePerson = RosterCompatibility.personIndex(people, {
    MO: rosterV2Directory_('TeamMembers'), EP: rosterV2Directory_('EmergencyPhysicians')
  });
  const result = RosterCompatibility.projectPeriod(periodId, rows, resolvePerson, periods);
  const expected = rows.filter(function(row) { const date = RosterCompatibility.localDate(row.Date); return date && date.slice(0,7) === periodId; });
  result.reconciliation = RosterCompatibility.reconcileRows(RosterCompatibility.legacyTransportRows(expected), RosterCompatibility.legacyProjection(result));
  result.reconciliation.complete = result.unplaced.length === 0;
  result.checksum = rosterV2Digest_(RosterCompatibility.canonicalJson(RosterCompatibility.legacyProjection(result)));
  result.semanticCatalogStatus = rosterV2CatalogStatus_();
  // Only Name/Date/Shift and safe identity fields are projected. Never return raw Settings,
  // Requests/LeaveApplications notes, arbitrary extra columns or administrator properties.
  return result;
}

function rosterV2CatalogStatus_() {
  const table = rosterV2ReadTable_('ShiftSemantics');
  if (!table.exists) return { source: 'BUNDLED_RULE_1', storedCatalogPresent: false, differences: [] };
  const expected = rosterV2CatalogRows_();
  const differences = RosterCompatibility.reconcileRows(expected, table.rows);
  // This status is public. Report drift without echoing arbitrary stored cell values.
  const summary = { match: differences.match, multisetEqual: differences.multisetEqual,
    orderChanged: differences.orderChanged,
    missingCount: differences.missing.reduce(function(n, item) { return n + item.count; }, 0),
    extraCount: differences.extra.reduce(function(n, item) { return n + item.count; }, 0) };
  return { source: 'BUNDLED_RULE_1', storedCatalogPresent: true,
    headerMatch: RosterCompatibility.canonicalJson(table.headers) === RosterCompatibility.canonicalJson(RosterCompatibility.schemas.ShiftSemantics),
    reconciliation: summary };
}

function rosterV2CatalogRows_() {
  return Object.keys(RosterCompatibility.catalog).map(function(raw) {
    const s = RosterCompatibility.resolveShift(raw);
    return [raw, 1, s.directoryType, s.worked, s.consecutive, s.staffingBucket || '', s.policyBQualifier,
      s.normalOff, s.canDisplaceOffEarnGoff, JSON.stringify(s.expectedPredecessors), JSON.stringify(s.expectedFollowers)];
  });
}

function rosterV2Digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Editor/internal utility only: no route, no network, no sheet creation or repair.
// Caller supplies dataset tables to retain exact header order/duplicates and raw values.
function rosterV2Snapshot_(datasets) {
  return RosterCompatibility.snapshotDatasets(datasets, rosterV2Digest_);
}

function rosterV2RequireAdmin_() {
  // The principal is established by Google, never by a request field, frontend PIN,
  // temporary user key, or getEffectiveUser (which is the deployer for anonymous callers).
  let allowed = '', caller = '';
  try {
    allowed = String(PropertiesService.getScriptProperties().getProperty('ROSTER_V2_ADMIN_EMAIL') || '').trim().toLowerCase();
    caller = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (error) { throw new Error('V2 administrator authorization required.'); }
  if (!allowed || !caller || allowed !== caller) throw new Error('V2 administrator authorization required.');
  return { email: caller };
}

function rosterV2DispatchGet_(parameters) {
  const action = String(parameters.action || '').toLowerCase();
  if (['rosterv2draft','rosterv2operation','rosterv2draftschema'].includes(action)) return rosterDraftRoute_(action, parameters);
  if (['rosterv2offpolicies','rosterv2guidanceschema'].includes(action)) return rosterGuidanceRoute_(action, parameters);
  if (['rosterv2lifecycleschema','rosterv2periodlifecycle','rosterv2amendmenthistory','rosterv2planned','rosterv2current'].includes(action)) return rosterLifecycleRoute_(action, parameters);
  if (action === 'rosterv2schema') return createJsonResponse(rosterV2Schema_());
  if (action === 'rosterv2period') return createJsonResponse(rosterV2Period_(parameters));
  // Reserve the namespace: private/unknown v2 reads cannot fall through to legacy Requests.
  rosterV2RequireAdmin_();
  throw new Error('Phase 1 does not expose private v2 data or official operations.');
}

function rosterV2DispatchPost_(data) {
  const action = String(data.action || '').toLowerCase();
  if (['rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon'].includes(action)) return rosterDraftRoute_(action, data);
  if (['rosterv2offpolicy','rosterv2offpolicyrecover'].includes(action)) return rosterGuidanceRoute_(action, data);
  if (['rosterv2publish','rosterv2close','rosterv2reopen','rosterv2lifecyclerecover','rosterv2amend','rosterv2amendreversal'].includes(action)) return rosterLifecycleRoute_(action, data);
  rosterV2RequireAdmin_();
  throw new Error('Official v2 writes are disabled in Phase 1.');
}

function rosterV2GuardSetting_(key) {
  if (!RosterCompatibility.isReservedSetting(String(key || '').trim())) return;
  rosterV2RequireAdmin_();
  throw new Error('V2 configuration writes are disabled in Phase 1.');
}

function rosterV2GuardLegacyUpload_(data) {
  const settings = rosterV2Settings_();
  if (settings.legacy_upload_enabled === 'false') {
    throw new Error('Legacy roster upload is disabled.');
  }

  const table = rosterV2ReadTable_('RosterPeriods');
  if (!table.exists || !table.rows.some(function(row) { return row.some(function(v) { return v !== '' && v !== null; }); })) {
    return; // No RosterPeriods table or no rows -> all periods are legacy
  }

  const periodIdIdx = table.headers.indexOf('PeriodId');
  const stateIdx = table.headers.indexOf('State');
  const statusIdx = table.headers.indexOf('Status');
  const schemaVerIdx = table.headers.indexOf('SchemaVersion');

  const protectedPeriods = new Set();
  table.rows.forEach(function(row) {
    if (!row || !row.some(function(v) { return v !== '' && v !== null; })) return;
    const pid = periodIdIdx >= 0 ? String(row[periodIdIdx] || '').trim() : '';
    if (!pid) {
      protectedPeriods.add('__ANY__');
      return;
    }

    const state = stateIdx >= 0 ? String(row[stateIdx] || '').trim().toUpperCase() : '';
    const status = statusIdx >= 0 ? String(row[statusIdx] || '').trim().toUpperCase() : '';
    const schemaVer = schemaVerIdx >= 0 ? Number(row[schemaVerIdx]) : 0;

    const isProtected = (schemaVer >= 2) || (status === 'ENROLLED') ||
      ['DRAFT', 'PUBLISHED', 'CLOSED', 'AMENDED'].includes(state) ||
      (schemaVerIdx >= 0 && statusIdx === -1 && stateIdx === -1);

    if (isProtected) {
      protectedPeriods.add(pid);
    }
  });

  if (protectedPeriods.size === 0) return;

  const isMonthScoped = data && typeof data === 'object' && Boolean(data.targetMonth);

  if (!isMonthScoped) {
    // Full roster upload without targetMonth clears the entire sheet.
    // If any enrollment exists, block the full upload to protect enrolled months.
    throw new Error('Legacy full-roster upload is blocked because RosterPeriods contains enrollment data.');
  }

  // Month-scoped upload: identify touched periods
  const targetMonth = String(data.targetMonth).trim().slice(0, 7);
  const touchedPeriods = new Set();
  if (/^\d{4}-\d{2}$/.test(targetMonth)) touchedPeriods.add(targetMonth);

  const rows = Array.isArray(data.rows) ? data.rows : [];
  rows.forEach(function(r) {
    const dateStr = typeof r === 'object' && r ? (r.date || r.Date || (Array.isArray(r) ? r[1] : '')) : '';
    const m = typeof dateStr === 'string' && /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : '';
    if (m) touchedPeriods.add(m);
  });

  const blocked = [];
  touchedPeriods.forEach(function(p) {
    if (protectedPeriods.has(p) || protectedPeriods.has('__ANY__')) blocked.push(p);
  });

  if (blocked.length > 0) {
    throw new Error('Legacy roster upload is blocked because RosterPeriods contains enrollment data for protected period(s): ' + blocked.join(', '));
  }
}
