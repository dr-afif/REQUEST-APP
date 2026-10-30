import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../../src/features/roster/compatibility.js';
import { compareLegacyPeriod, snapshotChecksums } from '../../src/features/roster/shadow.js';
import { harness, fixture, digest } from './apps-script-harness.mjs';

test('all initial semantic codes and aliases have deterministic frontend/backend parity',()=>{
  const backend=harness().core();
  const cases=['AM','PM','OH','COURT','ON1','ON2','ON','N','NIGHT','PN','OFF','GOFF','AL','MC','EL','HKA','GHKA','COURSE','','EP_OFFICE_HOUR','EP_ONCALL',
    'AMX','AM(X)','AM (X)','PMX','PM(X)','PM (X)','AM (S)','PM (S)','OFF (S)','GOFF (S)','HKA (S)','GHKA (S)','COURSE (S)','AM-S','PM-X'];
  for(const raw of cases){const actual=core.resolveShift(raw);assert.equal(actual.known,true,raw);assert.equal(actual.rawShift,raw);assert.deepEqual(JSON.parse(JSON.stringify(backend.resolveShift(raw))),actual,raw);}
  assert.equal(core.resolveShift('COURT').worked,true);assert.equal(core.resolveShift('COURT').providesStaffingCoverage,false);
  assert.equal(core.resolveShift('COURT').policyBQualifier,false);assert.equal(core.resolveShift('COURT').canDisplaceOffEarnGoff,true);
  for(const raw of ['ON','N','NIGHT']){assert.equal(core.resolveShift(raw).canonicalCode,raw);assert.equal(core.resolveShift(raw).legacyGenericNight,true);}
  assert.deepEqual(core.resolveShift('ON1').expectedFollowers,['ON2','PN']);
  assert.deepEqual(core.resolveShift('ON2').expectedFollowers,['PN']);
  assert.deepEqual(core.resolveShift('ON2').expectedPredecessors,['ON1']);
  assert.deepEqual(core.staffingDefaults,{amMinimum:2,pmMinimum:3,nightMinimum:2,nightMaximum:2,distribution:{pmAtLeastAm:true,maximumPmMinusAm:1},advisory:true,appliesOnWeekendsAndPublicHolidays:true,holidayReductionRequiresHodAuthorization:true});
});
test('PN is transparent, never staffing, and multiple worked shifts count once per date',()=>{
  const pn=core.resolveShift('PN');assert.equal(pn.worked,false);assert.equal(pn.providesStaffingCoverage,false);assert.equal(pn.policyBQualifier,true);assert.equal(pn.normalOff,false);assert.equal(pn.canDisplaceOffEarnGoff,true);
  let count=0;for(const shifts of [['AM'],['ON1'],['ON2'],['PN'],['AM']])count=core.advanceWorkedDays(count,core.classifyCalendarDay(shifts));
  assert.equal(count,4);
  for(const shifts of [['AM','PM'],['AM','PN'],['OFF (S)','AM'],['AM','AM']])assert.equal(core.classifyCalendarDay(shifts).workedCalendarDays,1);
  assert.equal(core.advanceWorkedDays(4,core.classifyCalendarDay(['OFF'])),0);
  assert.equal(core.advanceWorkedDays(4,core.classifyCalendarDay(['PN'])),4);
});
test('every initial base code satisfies the approved semantic matrix',()=>{
  const expected={
    AM:[true,'INCREMENT','AM',false,false,true], PM:[true,'INCREMENT','PM',false,false,true], OH:[true,'INCREMENT','OH',false,false,true],
    COURT:[true,'INCREMENT',null,false,false,true],
    ON1:[true,'INCREMENT','NIGHT',true,false,true],ON2:[true,'INCREMENT','NIGHT',true,false,true],ON:[true,'INCREMENT','NIGHT',true,false,true],N:[true,'INCREMENT','NIGHT',true,false,true],NIGHT:[true,'INCREMENT','NIGHT',true,false,true],
    PN:[false,'TRANSPARENT',null,true,false,true],OFF:[false,'RESET',null,false,true,false],
    GOFF:[false,'RESET',null,false,false,false],HKA:[false,'RESET',null,false,false,false],GHKA:[false,'RESET',null,false,false,false],AL:[false,'RESET',null,false,false,false],MC:[false,'RESET',null,false,false,false],EL:[false,'RESET',null,false,false,false],COURSE:[false,'RESET',null,false,false,false],'':[false,'RESET',null,false,false,false],
    EP_OFFICE_HOUR:[false,'EXCLUDED',null,false,false,false],EP_ONCALL:[false,'EXCLUDED',null,false,false,false],
  };
  assert.deepEqual(Object.keys(core.catalog).sort(),Object.keys(expected).sort());
  for(const [raw,tuple] of Object.entries(expected)){const s=core.resolveShift(raw);assert.deepEqual([s.worked,s.consecutive,s.staffingBucket,s.policyBQualifier,s.normalOff,s.canDisplaceOffEarnGoff],tuple,raw);}
});
test('modifiers preserve base semantics without treating standby as attendance',()=>{
  for(const raw of ['AMX','AM(X)','AM (X)','AM-X']){const s=core.resolveShift(raw);assert.equal(s.baseCode,'AM');assert.equal(s.modifiers.extended,true);assert.equal(s.rawShift,raw);}
  for(const base of ['AM','PM','OFF','GOFF','HKA','GHKA','COURSE']){
    const s=core.resolveShift(base+' (S)');assert.equal(s.worked,core.resolveShift(base).worked);assert.equal(s.attendanceInferred,false);assert.equal(s.modifiers.standby,true);
  }
  for(const raw of ['GOFF','HKA','GHKA','AL','MC','EL','COURSE','PN'])assert.equal(core.resolveShift(raw).normalOff,false);
  assert.equal(core.resolveShift('OFF (S)').normalOff,true);
});
test('unknowns stay explicit, do not turn into blank/OFF, and do not silently reset work',()=>{
  for(const raw of ['UNMAPPED_TEST','MYSTERYX','(S)','AM(S)BROKEN','PH','__proto__','constructor']){
    const s=core.resolveShift(raw);assert.equal(s.known,false,raw);assert.equal(s.rawShift,raw);assert.equal(s.worked,null);assert.equal(s.consecutive,'UNKNOWN');assert.equal(s.canDisplaceOffEarnGoff,null);
  }
  assert.equal(core.advanceWorkedDays(4,core.classifyCalendarDay(['MYSTERY'])),null);
});
test('EP assignments and roles contribute nothing to MO work, staffing, OFF or GOFF',()=>{
  for(const raw of ['EP_OFFICE_HOUR','EP_ONCALL']){
    const s=core.resolveShift(raw);assert.equal(s.worked,false);assert.equal(s.consecutive,'EXCLUDED');assert.equal(s.policyBQualifier,false);assert.equal(s.normalOff,false);assert.equal(s.canDisplaceOffEarnGoff,false);
  }
  assert.equal(core.advanceWorkedDays(4,core.classifyCalendarDay(['EP_OFFICE_HOUR','EP_ONCALL'])),4);
  assert.equal(core.resolveShift('AM','EP').providesStaffingCoverage,false);
});
test('stable identities survive renames; approved aliases, roles, orphans and inactive history remain distinct',()=>{
  const old=core.createPerson({personId:'person-mo-1',displayName:'Syuhada',directoryType:'MO',active:false});
  const renamed=core.renamePerson(old,'New Display');assert.equal(old.CurrentDisplayName,'Syuhada');assert.equal(renamed.PersonId,old.PersonId);
  const people=[renamed,core.createPerson({personId:'person-ep-1',displayName:'Echo',directoryType:'EP'})];
  const resolve=core.personIndex(people);
  for(const raw of ['SYU','Syu','SYUHADA','Syuhada','New Display']){assert.equal(resolve(raw).personId,'person-mo-1');assert.equal(resolve(raw).rawName,raw);assert.equal(resolve(raw).active,false);}
  for(const raw of ['DR ECHO','Dr. Echo','Echo'])assert.equal(resolve(raw,'EP').personId,'person-ep-1');
  assert.equal(resolve('Dr. Echo','MO').personId,null);
  assert.equal(resolve('Amir').active,false);assert.equal(resolve('Amir').historicalOnly,true);assert.equal(resolve('Amir').personId,null);
  assert.notEqual(resolve('Aiman').legacyPersonKey,resolve('Amir').legacyPersonKey);
  assert.throws(()=>core.personIndex([...people,core.createPerson({personId:'other',displayName:'Syu',directoryType:'MO'})]),/Ambiguous/);
  const auto=core.personIndex([], {MO:[{name:'Echo'}],EP:[{name:'Echo'}]});assert.equal(auto('Echo','AUTO').identityStatus,'AMBIGUOUS_DOMAIN');
});
test('legacy record adapters preserve concurrent active requests, orphan and mismatched note exactly',()=>{
  const records=fixture.tables.Requests.slice(1).map(row=>Object.fromEntries(fixture.tables.Requests[0].map((h,i)=>[h,row[i]])));
  const before=JSON.stringify(records);const projected=core.adaptLegacyRecords(records,core.personIndex());
  assert.equal(projected.filter(r=>r.raw.Status==='Active').length,2);assert.equal(projected[2].person.historicalOnly,true);assert.equal(projected[2].person.active,false);assert.equal(JSON.stringify(records),before);
  const leave={MemberName:'Person B',StartDate:'2030-09-04',EndDate:'2030-09-04',Days:1,Notes:'3 & 4 /9/2030'};
  assert.deepEqual(core.adaptLegacyRecords([leave],core.personIndex(),{nameField:'MemberName'})[0].raw,leave);
});
test('period projection keeps every row, duplicate occurrence and EP pair; dates are UTC+08',()=>{
  const rows=fixture.tables.MasterRoster.slice(1).map(([Name,Date,Shift])=>({Name,Date,Shift}));
  const result=core.projectPeriod('2030-07',rows,core.personIndex());
  assert.equal(result.assignments.length,12);assert.equal(result.assignments.filter(a=>a.person.directoryType==='EP').length,2);
  assert.equal(result.assignments.filter(a=>a.raw.Name==='Person A' && a.date==='2030-07-28').length,3);
  assert.equal(new Set(result.assignments.map(a=>a.sourceKey)).size,12);
  assert.equal(result.period.mode,'LEGACY');assert.equal(result.period.readOnly,true);assert.equal(result.plannedSnapshotAvailable,false);
  assert.equal(compareLegacyPeriod('2030-07',rows,result).match,true);
  assert.equal(core.localDate('2030-06-30T16:00:00.000Z'),'2030-07-01');
  assert.equal(core.localDate('2030-07-31T16:00:00.000Z'),'2030-08-01');
  assert.equal(core.localDate('2030-12-31T16:00:00.000Z'),'2031-01-01');
  assert.equal(core.localDate('2030-02-30'),null);assert.equal(core.localDate('2030-02-30T16:00:00Z'),null);
  const bad=core.projectPeriod('2030-07',[{Name:'X',Date:'bad',Shift:'PN'}],core.personIndex());assert.equal(bad.unplaced.length,1);assert.equal(bad.unplaced[0].raw.Date,'bad');
  assert.throws(()=>core.periodInfo('2030-13'),/YYYY-MM/);
  assert.equal(core.periodInfo('2030-07',[{PeriodId:'2030-07',SchemaVersion:2,EnrolledAt:'2030-06-01',EnrolledBy:'owner'}]).mode,'ENROLLED');
});
test('checksums preserve types, duplicate/blank headers, order, multiplicity and immutable snapshot data',async()=>{
  const data={Requests:{headers:['Name','',''],rows:[['X','',12.0833333333333]],formulas:[['','','=145/12']]},Settings:{headers:['Key','Value'],rows:fixture.tables.Settings.slice(1)}};
  const snapshots=core.snapshotDatasets(data,digest);assert.deepEqual(await snapshotChecksums(data),snapshots);
  const backend=harness();assert.deepEqual(JSON.parse(JSON.stringify(backend.context.rosterV2Snapshot_(data))),snapshots);
  assert.equal(digest(core.canonicalJson({b:2,a:1})),digest(core.canonicalJson({a:1,b:2})));
  assert.notEqual(core.canonicalJson(new Date('2030-01-01')),core.canonicalJson('2030-01-01T00:00:00.000Z'));
  assert.notEqual(core.canonicalJson(new Date('2030-01-01')),core.canonicalJson({$date:'2030-01-01T00:00:00.000Z'}));
  data.Requests.rows[0][2]=0;assert.equal(snapshots[0].data.rows[0][2],12.0833333333333);
  const a={Name:'X',Date:'2030-07-01',Shift:'AM'},b={...a,Shift:'PM'};
  assert.equal(core.reconcileRows([a,a,b],[a,b]).missing[0].count,1);
  assert.equal(core.reconcileRows([a,b],[b,a]).orderChanged,true);
  assert.equal(core.reconcileRows([a],[a,b]).extra[0].count,1);
  assert.equal(core.reconcileRows([a],[{...a,Name:'x'}]).match,false);
});


test('ambiguous domains use the same unknown semantics in resolver, classifier and projection',()=>{
  const backend=harness().core();
  for(const contract of [core,backend]){
    const s=contract.resolveShift('AM (S)','UNKNOWN');
    assert.equal(s.directoryType,'UNKNOWN');assert.equal(s.moApplicable,null);
    for(const key of ['worked','providesStaffingCoverage','policyBQualifier','canDisplaceOffEarnGoff'])assert.equal(s[key],null,key);
    assert.equal(s.consecutive,'UNKNOWN');assert.equal(s.modifiers.standby,true);
    assert.deepEqual([...s.issues],['AMBIGUOUS_DOMAIN']);
    const a={rawShift:'AM (S)',directoryType:'UNKNOWN'};
    assert.equal(contract.classifyCalendarDay([a]).behavior,'UNKNOWN');
    assert.equal(contract.advanceWorkedDays(3,contract.classifyCalendarDay([a])),null);
    const mixed=contract.classifyCalendarDay([a,'AM','PM']);
    assert.equal(mixed.workedCalendarDays,1);assert.ok(mixed.issues.includes('AMBIGUOUS_DOMAIN'));
    const resolve=contract.personIndex([],{MO:['Shared'],EP:['Shared']});
    const p=contract.projectPeriod('2030-07',[{Name:'Shared',Date:'2030-07-01',Shift:'AM (S)'}],resolve);
    assert.deepEqual(JSON.parse(JSON.stringify(p.assignments[0].semantics)),JSON.parse(JSON.stringify(s)));
    assert.equal(contract.resolveShift('EP_ONCALL','UNKNOWN').consecutive,'EXCLUDED');
  }
});
test('shadow comparison normalizes Date transport only and preserves duplicates and real changes',()=>{
  const rows=[{Name:'Example',Date:new Date('2030-06-30T16:00:00Z'),Shift:'AM'}];
  rows.push({...rows[0]});
  const before=structuredClone(rows);
  const wire=JSON.parse(JSON.stringify(core.projectPeriod('2030-07',rows,core.personIndex())));
  assert.equal(compareLegacyPeriod('2030-07',rows,wire).match,true);
  assert.equal(compareLegacyPeriod('2030-07',rows.slice(1),wire).extra[0].count,1);
  const changed=structuredClone(wire);changed.assignments[0].raw.Date='2030-07-01';
  assert.equal(compareLegacyPeriod('2030-07',rows,changed).match,false);
  assert.notEqual(core.canonicalJson(rows),core.canonicalJson(JSON.parse(JSON.stringify(rows))));
  assert.deepEqual(rows,before);
});
test('shadow comparison is incomplete when either source contains unplaced dates',()=>{
  const row={Name:'Example',Date:'2030-07-01',Shift:'AM'}, bad={Name:'Historical',Date:'invalid',Shift:'PN'};
  for(const [localInvalid,serverInvalid] of [[true,false],[false,true],[true,true],[false,false]]){
    const rows=[row,...(localInvalid?[bad]:[])], before=structuredClone(rows);
    const server=core.projectPeriod('2030-07',[row,...(serverInvalid?[bad]:[])],core.personIndex());
    const result=compareLegacyPeriod('2030-07',rows,server);
    assert.equal(result.match,true);assert.equal(result.complete,!localInvalid&&!serverInvalid);
    assert.equal(result.localUnplacedCount,Number(localInvalid));assert.equal(result.unplacedCount,Number(serverInvalid));
    assert.deepEqual(rows,before);
  }
});
test('missing and false-like switch values never enable configured or effective workflows',()=>{
  for(const value of [undefined,null,false,'false','FALSE','True','1',1,'yes','',{}]){
    const settings=Object.fromEntries(Object.keys(core.featureDefaults).map(key=>[key,value]));
    assert.deepEqual(core.featureSwitches(settings),core.featureDefaults);
    assert.deepEqual(JSON.parse(JSON.stringify(harness().core().featureSwitches(settings))),core.featureDefaults);
  }
});
