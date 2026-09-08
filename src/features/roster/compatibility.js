// Single pure contract shared with Apps Script by scripts/build-appscript.mjs.
// No I/O, enrollment, historical edits, attendance inference or ledger effects.
const RosterCompatibility = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const featureDefaults = freeze(Object.fromEntries([
    'roster_v2_read_enabled', 'roster_v2_write_enabled', 'shift_semantics_v2_enabled',
    'weekly_off_guidance_enabled', 'night_safety_guidance_enabled', 'goff_ledger_enabled',
    'write_queue_v2_enabled', 'roster_workspace_v2_enabled',
  ].map(key => [key, false])));
  const schemas = freeze({
    RosterPeople: ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active', 'CreatedAt', 'UpdatedAt'],
    RosterPeriods: ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy'],
    ShiftSemantics: ['ShiftCode', 'RuleVersion', 'DirectoryType', 'CountsAsWorked', 'ConsecutiveBehavior', 'StaffingBucket', 'PolicyBQualifier', 'NormalOff', 'CanDisplaceOffEarnGoff', 'ExpectedPredecessorsJson', 'ExpectedFollowersJson'],
  });
  const staffingDefaults = freeze({ amMinimum: 2, pmMinimum: 3, nightMinimum: 2, nightMaximum: 2,
    distribution: { pmAtLeastAm: true, maximumPmMinusAm: 1 }, advisory: true,
    appliesOnWeekendsAndPublicHolidays: true, holidayReductionRequiresHodAuthorization: true });
  const code = (worked, consecutive, staffingBucket, policyBQualifier = false, normalOff = false, displacesOff = worked, predecessors = [], followers = [], domain = 'MO') =>
    ({ worked, consecutive, staffingBucket, policyBQualifier, normalOff, displacesOff, predecessors, followers, domain });
  const catalog = freeze({
    AM: code(true, 'INCREMENT', 'AM'), PM: code(true, 'INCREMENT', 'PM'),
    OH: code(true, 'INCREMENT', 'OH'), COURT: code(true, 'INCREMENT', null),
    ON1: code(true, 'INCREMENT', 'NIGHT', true, false, true, [], ['ON2', 'PN']),
    ON2: code(true, 'INCREMENT', 'NIGHT', true, false, true, ['ON1'], ['PN']),
    ON: code(true, 'INCREMENT', 'NIGHT', true, false, true, [], ['PN']),
    N: code(true, 'INCREMENT', 'NIGHT', true, false, true, [], ['PN']),
    NIGHT: code(true, 'INCREMENT', 'NIGHT', true, false, true, [], ['PN']),
    PN: code(false, 'TRANSPARENT', null, true, false, true, ['ON1', 'ON2', 'ON', 'N', 'NIGHT']),
    OFF: code(false, 'RESET', null, false, true),
    GOFF: code(false, 'RESET', null), HKA: code(false, 'RESET', null), GHKA: code(false, 'RESET', null),
    AL: code(false, 'RESET', null), MC: code(false, 'RESET', null), EL: code(false, 'RESET', null),
    COURSE: code(false, 'RESET', null), '': code(false, 'RESET', null),
    EP_OFFICE_HOUR: code(false, 'EXCLUDED', null, false, false, false, [], [], 'EP'),
    EP_ONCALL: code(false, 'EXCLUDED', null, false, false, false, [], [], 'EP'),
  });
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  function resolveShift(rawShift, directoryType = 'MO') {
    const raw = rawShift == null ? '' : String(rawShift);
    let base = raw.trim().toUpperCase();
    const modifiers = { extended: false, standby: false };
    // Parse suffixes only. Unknown bases stay unknown; embedded markers are not stripped.
    let match;
    while ((match = /\s*(?:\(([XS])\)|-([XS]))$/.exec(base))) {
      modifiers[(match[1] || match[2]) === 'X' ? 'extended' : 'standby'] = true;
      base = base.slice(0, match.index).trim();
    }
    if (base === 'AMX' || base === 'PMX') { modifiers.extended = true; base = base.slice(0, -1); }
    const known = owns(catalog, base) && (base !== '' || raw.trim() === '');
    const initial = known ? catalog[base] : code(null, 'UNKNOWN', null, null, false, null);
    const ep = directoryType === 'EP' || initial.domain === 'EP';
    const ambiguous = !ep && directoryType === 'UNKNOWN';
    return {
      rawShift: raw, baseCode: base, canonicalCode: base, modifiers, known, ruleVersion: 1,
      directoryType: ep ? 'EP' : ambiguous ? 'UNKNOWN' : 'MO', moApplicable: ambiguous ? null : !ep,
      worked: ep ? false : ambiguous ? null : initial.worked,
      consecutive: ep ? 'EXCLUDED' : ambiguous ? 'UNKNOWN' : initial.consecutive,
      staffingBucket: ep || ambiguous ? null : initial.staffingBucket,
      providesStaffingCoverage: ep ? false : ambiguous ? null : known ? initial.staffingBucket !== null : null,
      policyBQualifier: ep ? false : ambiguous ? null : initial.policyBQualifier,
      normalOff: !ep && !ambiguous && initial.normalOff,
      canDisplaceOffEarnGoff: ep ? false : ambiguous ? null : initial.displacesOff,
      expectedPredecessors: ep || ambiguous ? [] : [...initial.predecessors], expectedFollowers: ep || ambiguous ? [] : [...initial.followers],
      legacyGenericNight: ['ON', 'N', 'NIGHT'].includes(base),
      policyBasis: 'PUBLISHED_PLANNED', attendanceInferred: false,
      issues: [...(known ? [] : ['UNKNOWN_SHIFT']), ...(ambiguous ? ['AMBIGUOUS_DOMAIN'] : [])],
    };
  }
  function classifyCalendarDay(assignments) {
    const semantics = assignments.map(a => typeof a === 'string' ? resolveShift(a) : resolveShift(a.rawShift, a.directoryType));
    const mo = semantics.filter(s => s.moApplicable !== false);
    const unknown = mo.some(s => s.consecutive === 'UNKNOWN');
    // Actual worked assignments dominate a coexisting PN/OFF; count a date only once.
    const behavior = mo.some(s => s.worked === true) ? 'INCREMENT' : unknown ? 'UNKNOWN'
      : mo.some(s => s.consecutive === 'RESET') ? 'RESET'
        : mo.some(s => s.consecutive === 'TRANSPARENT') ? 'TRANSPARENT' : semantics.length ? 'EXCLUDED' : 'RESET';
    return { behavior, workedCalendarDays: behavior === 'INCREMENT' ? 1 : 0, issues: [...new Set(semantics.flatMap(s => s.issues))] };
  }
  function advanceWorkedDays(count, day) {
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid worked-day count');
    if (day.behavior === 'UNKNOWN') return null;
    return day.behavior === 'RESET' ? 0 : count + day.workedCalendarDays;
  }
  function featureSwitches(settings = {}) {
    return Object.fromEntries(Object.keys(featureDefaults).map(key => [key, settings[key] === true || settings[key] === 'true']));
  }
  function isReservedSetting(key) {
    return owns(featureDefaults, key) || ['legacy_upload_enabled', 'goff_commencement_period', 'goff_opening_batch_status', 'legacy_read_only_before'].includes(key) || key.startsWith('roster_v2_');
  }
  function canonicalName(name, domain) {
    let normalized = String(name ?? '').trim().toUpperCase();
    if (domain === 'EP') normalized = normalized.replace(/^DR\.?\s+/, '');
    if (domain === 'MO' && normalized === 'SYU') normalized = 'SYUHADA';
    return normalized;
  }
  const isActive = value => value === undefined || value === null || value === '' ? true : !['FALSE', 'INACTIVE', 'NO', '0'].includes(String(value).trim().toUpperCase());
  function createPerson({ personId, displayName, directoryType, aliases = [], active = true }) {
    if (!String(personId || '').trim() || !String(displayName || '').trim() || !['MO', 'EP'].includes(directoryType)) throw new Error('Invalid stable person');
    if (!Array.isArray(aliases) || aliases.some(a => typeof a !== 'string')) throw new Error('Invalid aliases');
    return { PersonId: personId, DirectoryType: directoryType, CurrentDisplayName: displayName,
      LegacyNamesJson: JSON.stringify([...new Set([displayName, ...aliases])]), Active: !!active };
  }
  function renamePerson(person, displayName) {
    const aliases = JSON.parse(person.LegacyNamesJson || '[]');
    if (!Array.isArray(aliases)) throw new Error('Invalid aliases');
    return { ...person, ...createPerson({ personId: person.PersonId, directoryType: person.DirectoryType,
      displayName, aliases: [person.CurrentDisplayName, ...aliases], active: isActive(person.Active) }) };
  }
  function personIndex(people = [], directories = { MO: [], EP: [] }) {
    const identities = new Map(), ids = new Set(), directory = new Map();
    for (const person of people) {
      if (!person.PersonId || ids.has(person.PersonId) || !['MO', 'EP'].includes(person.DirectoryType) || !person.CurrentDisplayName) throw new Error('Invalid or duplicate RosterPeople identity');
      ids.add(person.PersonId);
      const aliases = JSON.parse(person.LegacyNamesJson || '[]');
      if (!Array.isArray(aliases) || aliases.some(a => typeof a !== 'string')) throw new Error('Invalid RosterPeople aliases');
      for (const name of [person.CurrentDisplayName, ...aliases]) {
        const key = person.DirectoryType + ':' + canonicalName(name, person.DirectoryType);
        if (identities.has(key) && identities.get(key).PersonId !== person.PersonId) throw new Error('Ambiguous RosterPeople alias');
        identities.set(key, person);
      }
    }
    for (const domain of ['MO', 'EP']) {
      for (const entry of directories[domain] || []) {
        const name = typeof entry === 'string' ? entry : entry.MemberName ?? entry.name;
        if (!String(name ?? '').trim()) continue;
        const key = domain + ':' + canonicalName(name, domain);
        const item = { displayName: String(name), active: isActive(entry.Active ?? entry.active) };
        const previous = directory.get(key);
        // Preserve evidence of conflicting active states instead of silently selecting one.
        directory.set(key, previous ? { ...previous, active: previous.active === item.active ? item.active : null } : item);
      }
    }
    return function resolvePerson(rawName, domain = 'MO') {
      if (domain === 'AUTO') {
        const moKey = 'MO:' + canonicalName(rawName, 'MO'), epKey = 'EP:' + canonicalName(rawName, 'EP');
        const mo = identities.has(moKey) || directory.has(moKey), ep = identities.has(epKey) || directory.has(epKey);
        if (mo && ep) return { personId: null, rawName, displayName: String(rawName ?? ''), directoryType: 'UNKNOWN', active: null, identityStatus: 'AMBIGUOUS_DOMAIN', historicalOnly: false };
        domain = ep ? 'EP' : 'MO';
      }
      const keyName = canonicalName(rawName, domain), key = domain + ':' + keyName;
      const person = identities.get(key), current = directory.get(key);
      if (person) return { personId: person.PersonId, displayName: person.CurrentDisplayName, directoryType: domain,
        rawName, active: isActive(person.Active), identityStatus: 'REGISTERED', historicalOnly: false };
      // A shadow key is not a durable ID. No current directory row is created for an orphan.
      return { personId: null, legacyPersonKey: keyName ? 'legacy:' + domain + ':' + encodeURIComponent(keyName) : null,
        displayName: domain === 'MO' && keyName === 'SYUHADA' ? 'Syuhada' : current?.displayName ?? (domain === 'EP' ? String(rawName ?? '').trim().replace(/^dr\.?\s+/i, '') : String(rawName ?? '')),
        rawName, directoryType: domain, active: current ? current.active : false,
        identityStatus: keyName ? 'UNREGISTERED' : 'MISSING_NAME', historicalOnly: !current };
    };
  }
  function localDate(value) {
    const isDate = Object.prototype.toString.call(value) === '[object Date]';
    if (isDate) return Number.isFinite(value.getTime()) ? new Date(value.getTime() + 28800000).toISOString().slice(0, 10) : null;
    if (typeof value !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const t = Date.parse(value + 'T00:00:00Z');
      return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value ? value : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    if (localDate(value.slice(0,10)) === null) return null;
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t + 28800000).toISOString().slice(0,10) : null;
  }
  function validatePeriod(periodId) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) || periodId.slice(0,4) === '0000') throw new Error('Period must use YYYY-MM');
    return periodId;
  }
  function periodInfo(periodId, periods = []) {
    validatePeriod(periodId);
    const matches = periods.filter(p => p.PeriodId === periodId);
    if (matches.length > 1) throw new Error('Duplicate RosterPeriods enrollment');
    const p = matches[0];
    if (p && (Number(p.SchemaVersion) !== 2 || !p.EnrolledAt || !p.EnrolledBy)) throw new Error('Invalid RosterPeriods enrollment');
    return { periodId, mode: p ? 'ENROLLED' : 'LEGACY', readOnly: true, schemaVersion: p ? 2 : 1 };
  }
  function adaptLegacyRecords(rows, resolvePerson, { nameField = 'Name', domain = 'MO' } = {}) {
    return rows.map((raw, index) => ({ sourceIndex: index, person: resolvePerson(raw[nameField], domain), raw }));
  }
  function projectPeriod(periodId, rows, resolvePerson, periods = []) {
    const period = periodInfo(periodId, periods), assignments = [], unplaced = [];
    rows.forEach((row, index) => {
      const date = localDate(row.Date);
      if (!date) { unplaced.push({ sourceRow: index + 2, raw: { Name: row.Name, Date: row.Date, Shift: row.Shift }, issue: 'INVALID_DATE' }); return; }
      if (date.slice(0,7) !== periodId) return;
      const domain = resolveShift(row.Shift).directoryType === 'EP' ? 'EP' : 'AUTO';
      const person = resolvePerson(row.Name, domain);
      const semantics = resolveShift(row.Shift, person.directoryType);
      assignments.push({ sourceRow: index + 2, sourceKey: 'MasterRoster:' + (index + 2), identityIsSnapshotLocal: true,
        date, person, semantics, raw: { Name: row.Name, Date: row.Date, Shift: row.Shift } });
    });
    return { schemaVersion: 2, foundationVersion: 1, timezone: 'Asia/Kuala_Lumpur', period,
      projectionKind: 'LEGACY_SHADOW', plannedSnapshotAvailable: false, assignments, unplaced,
      issues: unplaced.map(r => ({ sourceRow: r.sourceRow, code: r.issue })) };
  }
  // Projection integrity follows the existing JSON wire representation of Sheet Dates.
  // Do not normalize date strings or use this for typed/raw backup snapshots.
  const legacyTransportRows = rows => rows.map(row => ({ Name: row.Name,
    Date: Object.prototype.toString.call(row.Date) === '[object Date]' ? row.Date.toJSON() : row.Date,
    Shift: row.Shift }));
  const legacyProjection = projection => legacyTransportRows(projection.assignments.map(a => a.raw));
  function canonicalJson(value) {
    // Typed tuples avoid collisions between Dates, strings and date-shaped objects.
    function encode(v) {
      if (Object.prototype.toString.call(v) === '[object Date]') return ['date', v.toISOString()];
      if (v === null) return ['null'];
      if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v];
      if (typeof v === 'number' && Number.isFinite(v)) return ['number', Object.is(v,-0) ? '-0' : String(v)];
      if (Array.isArray(v)) return ['array', v.map(encode)];
      if (v && typeof v === 'object') return ['object', Object.keys(v).sort().map(k => [k,encode(v[k])])];
      throw new Error('Unsupported snapshot value');
    }
    return JSON.stringify(encode(value));
  }
  function snapshotDatasets(datasets, digest) {
    return Object.keys(datasets).sort().map(name => {
      const { headers, rows, ...metadata } = datasets[name];
      if (!Array.isArray(headers) || !Array.isArray(rows)) throw new Error('Snapshot requires ordered headers and rows');
      const copy = v => Object.prototype.toString.call(v) === '[object Date]' ? new Date(v.getTime())
        : Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,item]) => [k,copy(item)])) : v;
      const data = copy({ headers, rows, metadata });
      return { name, rowCount: rows.length, headerChecksum: digest(canonicalJson(headers)),
        rowChecksum: digest(canonicalJson(rows)), checksum: digest(canonicalJson(data)), data };
    });
  }
  function reconcileRows(expected, actual) {
    const count = rows => { const map = new Map(); for (const row of rows) { const key = canonicalJson(row); const item = map.get(key); map.set(key, { row, count: (item?.count || 0) + 1 }); } return map; };
    const left = count(expected), right = count(actual), missing = [], extra = [];
    for (const [key, item] of left) { const n = item.count - (right.get(key)?.count || 0); if (n > 0) missing.push({ row: item.row, count: n }); }
    for (const [key, item] of right) { const n = item.count - (left.get(key)?.count || 0); if (n > 0) extra.push({ row: item.row, count: n }); }
    const orderedEqual = canonicalJson(expected) === canonicalJson(actual);
    return { match: orderedEqual, multisetEqual: !missing.length && !extra.length, orderChanged: !orderedEqual && !missing.length && !extra.length, missing, extra };
  }
  function schemaPlan(existingHeaders = {}) {
    return Object.entries(schemas).map(([name, headers]) => ({ name, headers: [...headers], exists: owns(existingHeaders, name),
      missingHeaders: headers.filter(h => !(existingHeaders[name] || []).includes(h)), action: owns(existingHeaders, name) ? 'INSPECT_ONLY' : 'PROPOSE_CREATE', apply: false }));
  }
  return freeze({ featureDefaults, schemas, staffingDefaults, catalog, resolveShift, classifyCalendarDay, advanceWorkedDays,
    featureSwitches, isReservedSetting, canonicalName, createPerson, renamePerson, personIndex, localDate, validatePeriod, periodInfo,
    adaptLegacyRecords, projectPeriod, legacyTransportRows, legacyProjection, canonicalJson, snapshotDatasets, reconcileRows, schemaPlan });
})();

export default RosterCompatibility;
