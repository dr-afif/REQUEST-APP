import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import core from '../../src/features/roster/compatibility.js';
import { fixture, harness, legacySource, currentSource, digest } from './apps-script-harness.mjs';

const getActions=['','requests','teammembers','emergencyphysicians','alldata','masterroster','shiftblocks','shifttypes','limitgroups','activityhistory','publicholidays','leaveapplications','settings','unknownlegacy'];
const posts=[
  {action:'submit',name:'Person A',date:'2030-07-28',request:'AM',comment:'Synthetic request'},
  {action:'update',id:'req-01',name:'Person A',date:'2030-07-28',request:'PM'},
  {action:'delete',id:'req-01'},
  {action:'uploadmasterroster',rows:[{name:'Person A',date:'2030-07-28',shift:'AM'},{name:'Person A',date:'2030-07-28',shift:'PM'}]},
  {action:'updaterequestapproval',id:'req-01',approvalStatus:'Approved'},
  {action:'addshiftblock',date:'2030-07-20',shiftType:'LEAVES',maxSlots:2},
  {action:'deleteshiftblock',id:'block-01'},
  {action:'addshifttype',name:'OH',isPublic:false,groupId:''},
  {action:'updateshifttype',id:'type-01',name:'AM',isPublic:true,groupId:''},
  {action:'deleteshifttype',id:'type-01'},
  {action:'reordershifttypes',ids:['type-02','type-01']},
  {action:'addlimitgroup',groupName:'Synthetic',defaultLimit:2},
  {action:'updatelimitgroup',id:'LEAVES',groupName:'Leaves & Offs',defaultLimit:3},
  {action:'deletelimitgroup',id:'LEAVES'},
  {action:'addactivity',name:'Person A',date:'2030-07-28',request:'AM'},
  {action:'deleteactivity',id:'act-01'},
  {action:'updatesetting',key:'phTrackerOpeningBalances',value:' {"synthetic":{"openingBalance":5}} '},
  {action:'updateteammembers',members:[{name:'Person A',active:true},{name:'Former Member',active:false}]},
  {action:'updateemergencyphysicians',members:[{name:'Echo',active:true}]},
  {action:'upsertpublicholiday',date:'2030-07-28',name:'Synthetic Holiday'},
  {action:'deletepublicholiday',date:'2030-07-28'},
  {action:'upsertleaveapplication',id:'leave-01',memberName:'Person B',leaveType:'MC',startDate:'2030-09-04',endDate:'2030-09-04',notes:'3 & 4 /9/2030'},
  {action:'deleteleaveapplication',id:'leave-01'},
];

test('comparison oracle is exactly the frozen Version 1 Git blob',()=>{
  // Git's text normalization removes CRLF on Windows; verify the immutable blob,
  // not the platform-specific checkout bytes. The expected digest remains fixed.
  const bytes=Buffer.from(fs.readFileSync(new URL('../fixtures/legacy-appscript-v1.txt',import.meta.url),'utf8').replaceAll('\r\n','\n'));
  assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'b9601899509b276742f516dc237d00af40a8b026');
});
for(const action of getActions)test(`legacy GET ${action||'(default)'} payload and workbook effects match Version 1`,()=>{
  const old=harness(legacySource),now=harness();
  assert.deepEqual(now.get(action),old.get(action));assert.deepEqual(now.jsonState(),old.jsonState());assert.deepEqual(now.writes,old.writes);
});
for(const payload of posts.filter(p=>p.action!=='uploadmasterroster'))test(`legacy POST ${payload.action} success and error contracts match Version 1`,()=>{
  const old=harness(legacySource),now=harness();
  const expected=old.post(payload);assert.equal(expected.result,'success',JSON.stringify(expected));assert.deepEqual(now.post(payload),expected);
  assert.deepEqual(now.jsonState(),old.jsonState());assert.deepEqual(now.writes,old.writes);
  const badOld=harness(legacySource),badNow=harness();assert.deepEqual(badNow.post({action:payload.action}),badOld.post({action:payload.action}));assert.deepEqual(badNow.jsonState(),badOld.jsonState());
});
test('legacy POST uploadmasterroster safety hotfix: requires targetMonth and fails closed on missing targetMonth',()=>{
  const h=harness();const before=h.jsonState();
  const bad=h.post({action:'uploadmasterroster',rows:[{name:'Person A',date:'2030-07-28',shift:'AM'}]});
  assert.equal(bad.result,'error');assert.match(bad.message,/targetMonth/);
  assert.deepEqual(h.jsonState(),before);assert.deepEqual(h.writes,[]);

  // Fail closed even if full replacement flags are passed: targetMonth is mandatory
  const badWithFlags=h.post({action:'uploadmasterroster',allowFullReplacement:true,rows:[{name:'Person A',date:'2030-07-28',shift:'AM'}]});
  assert.equal(badWithFlags.result,'error');assert.match(badWithFlags.message,/targetMonth/);
  assert.deepEqual(h.jsonState(),before);assert.deepEqual(h.writes,[]);
});
test('missing-sheet legacy GET side effects and old Settings failure remain unchanged',()=>{
  for(const action of getActions){const old=harness(legacySource,{tables:{}}),now=harness(currentSource,{tables:{}});assert.deepEqual(now.get(action),old.get(action),action);assert.deepEqual(now.jsonState(),old.jsonState(),action);}
});
test('all switches are OFF by default; discovery/shadow reads never initialize or mutate sheets',()=>{
  for(const tables of [{},fixture.tables]){
    const h=harness(currentSource,{tables}),before=h.jsonState();const schema=h.get('rosterv2schema');
    assert.equal(schema.schemaVersion,2);assert.equal(schema.capabilities.officialWrites,false);assert.equal(schema.capabilities.privateNotes,false);
    assert.ok(Object.values(schema.featureDefaults).every(v=>v===false));assert.ok(Object.values(schema.effectiveFeatures).every(v=>v===false));assert.ok(Object.values(schema.configuredFeatures).every(v=>v===false));
    const period=h.get('rosterv2period',{period:'2030-07',mode:'shadow'});assert.equal(period.projectionKind,'LEGACY_SHADOW');assert.equal(period.period.readOnly,true);assert.equal(period.reconciliation.match,true);
    assert.deepEqual(h.jsonState(),before);assert.deepEqual(h.writes,[]);
  }
});
test('configured future switches cannot enable writes/private notes or bypass authentication',()=>{
  const tables=structuredClone(fixture.tables);for(const key of Object.keys(core.featureDefaults))tables.Settings.push([key,'true']);
  const h=harness(currentSource,{tables});const schema=h.get('rosterv2schema');assert.ok(Object.values(schema.configuredFeatures).every(Boolean));assert.ok(Object.values(schema.effectiveFeatures).every(v=>v===false));
  for(const action of ['rosterv2publish','rosterv2close','rosterv2openingbalance','rosterv2enroll'])assert.equal(h.post({action,admin:true,email:'owner@example.invalid',pin:'1234'}).result,'error');
  assert.equal(h.get('rosterv2notes').result,'error');assert.equal(h.get('rosterv2period',{period:'2030-07'}).result,'error');assert.deepEqual(h.writes,[]);
});
test('server principal must match configured administrator; deployer identity and spoofed credentials are rejected',()=>{
  for(const options of [{},{adminEmail:'owner@example.invalid',effectiveEmail:'owner@example.invalid'},{adminEmail:'owner@example.invalid',activeEmail:'other@example.invalid'}]){
    const h=harness(currentSource,options);assert.match(h.post({action:'rosterv2publish',email:'owner@example.invalid',admin:true,pin:'1234'}).message,/authorization required/);
    assert.match(h.get('rosterv2notes',{email:'owner@example.invalid'}).message,/authorization required/);assert.deepEqual(h.writes,[]);
  }
  const h=harness(currentSource,{adminEmail:'OWNER@example.invalid',activeEmail:'owner@example.invalid'});
  assert.equal(h.context.rosterV2RequireAdmin_().email,'owner@example.invalid');
  assert.match(h.post({action:'rosterv2publish'}).message,/writes are disabled/);
  assert.match(h.get('rosterv2notes').message,/does not expose private/);
  assert.match(h.post({action:'updatesetting',key:'roster_v2_write_enabled',value:'true'}).message,/configuration writes are disabled/);assert.deepEqual(h.writes,[]);
});
test('public discovery/period responses contain no notes, contacts, properties or extra roster fields',()=>{
  const tables=structuredClone(fixture.tables);tables.MasterRoster[0].push('AdminNote');for(const row of tables.MasterRoster.slice(1))row.push('PRIVATE_MARKER');
  tables.Settings.push(['arbitrary_secret','PRIVATE_MARKER']);
  const h=harness(currentSource,{tables,adminEmail:'PRIVATE_MARKER'});
  for(const data of [h.get('rosterv2schema'),h.get('rosterv2period',{period:'2030-07',mode:'shadow'})]){
    assert.ok(!JSON.stringify(data).includes('PRIVATE_MARKER'));assert.ok(!JSON.stringify(data).includes('3 & 4'));assert.ok(!JSON.stringify(data).includes('ROSTER_V2_ADMIN_EMAIL'));
  }
  assert.deepEqual(h.writes,[]);
});
test('period endpoint uses registered identities and preserves blank rows, bad dates and duplicate assignments',()=>{
  const tables=structuredClone(fixture.tables);
  tables.RosterPeople=[core.schemas.RosterPeople,['durable-ep','EP','Echo','["Echo"]',true,'','']];
  tables.MasterRoster.splice(2,0,['','','']);tables.MasterRoster.push(['Person B','not-a-date','PN']);
  const h=harness(currentSource,{tables}),p=h.get('rosterv2period',{period:'2030-07',mode:'shadow'});
  assert.equal(p.assignments.filter(a=>a.person.personId==='durable-ep').length,2);assert.equal(p.unplaced.length,2);
  assert.equal(p.assignments[1].sourceRow,4);assert.equal(p.assignments.length,12);assert.equal(p.reconciliation.match,true);assert.equal(p.reconciliation.complete,false);assert.equal(p.unplaced[0].sourceRow,3);
  assert.deepEqual(h.writes,[]);
});
test('enrolled periods block ANY old global upload, including omitted months and empty payloads, even with every switch OFF',()=>{
  for(const row of [['2030-07',2,'2030-06-01','owner'],['malformed','','','']]){
    for(const rows of [[],[{name:'Other',date:'2030-08-01',shift:'AM'}],null]){
      const tables=structuredClone(fixture.tables);tables.RosterPeriods=[core.schemas.RosterPeriods,row];
      const h=harness(currentSource,{tables}),before=h.jsonState();const result=h.post({action:'uploadmasterroster',rows});assert.equal(result.result,'error');assert.match(result.message,/enrollment data/);
      assert.deepEqual(h.jsonState(),before);assert.deepEqual(h.writes,[]);assert.deepEqual(h.locks,['acquire','release']);
    }
  }
});
test('empty foundation tables keep legacy upload working; lock failure cannot clear data',()=>{
  const tables=structuredClone(fixture.tables);tables.RosterPeriods=[core.schemas.RosterPeriods];
  const payloadWithMonth={...posts[3],targetMonth:'2030-07'};
  const h=harness(currentSource,{tables});assert.equal(h.post(payloadWithMonth).result,'success');
  const locked=harness(currentSource,{failLock:true}),before=locked.jsonState();assert.equal(locked.post(payloadWithMonth).result,'error');assert.deepEqual(locked.jsonState(),before);assert.deepEqual(locked.writes,[]);
});
test('stored semantic catalog drift is reported and never silently changes rule 1',()=>{
  const h=harness();h.grids.ShiftSemantics=[core.schemas.ShiftSemantics,...h.context.rosterV2CatalogRows_()];
  assert.equal(h.get('rosterv2period',{period:'2030-07',mode:'shadow'}).semanticCatalogStatus.reconciliation.match,true);
  h.grids.ShiftSemantics[1][3]=false;
  const p=h.get('rosterv2period',{period:'2030-07',mode:'shadow'});assert.equal(p.semanticCatalogStatus.reconciliation.match,false);assert.equal(p.assignments[0].semantics.worked,true);assert.deepEqual(h.writes,[]);
});
test('PH/GHKA Settings JSON and note discrepancy remain byte-preserved by shadow read',()=>{
  const h=harness(),before=digest(JSON.stringify(h.jsonState()));h.get('rosterv2period',{period:'2030-07',mode:'shadow'});
  assert.equal(digest(JSON.stringify(h.jsonState())),before);assert.equal(h.grids.LeaveApplications[1][5],1);assert.equal(h.grids.LeaveApplications[1][9],'3 & 4 /9/2030');
  assert.equal(h.grids.Requests[3][12],12.0833333333333);assert.ok(!Object.keys(h.grids).some(k=>/Goff|OperationLog|Events/.test(k)));
});


test('shadow checksum survives real Sheet Dates and JSON transport at month and year boundaries',()=>{
  const h=harness();
  const dates=['2030-06-30T15:59:59Z','2030-06-30T16:00:00Z','2030-07-31T15:59:59Z','2030-07-31T16:00:00Z','2030-12-31T16:00:00Z'];
  h.grids.MasterRoster=[['Name','Date','Shift'],...dates.map(d=>['Example',new Date(d),'AM'])];
  h.grids.MasterRoster.push([...h.grids.MasterRoster[2]]);
  const before=structuredClone(h.grids);
  for(const [period,count] of [['2030-07',3],['2030-08',1],['2031-01',1]]){
    const result=h.get('rosterv2period',{period,mode:'shadow'});
    assert.equal(result.assignments.length,count);
    assert.equal(result.reconciliation.match,true);
    assert.equal(result.checksum,digest(core.canonicalJson(core.legacyProjection(result))));
    assert.equal(result.checksum,h.get('rosterv2period',{period,mode:'shadow'}).checksum);
  }
  assert.deepEqual(h.grids,before);
});
test('legacy Date-valued GET responses retain the frozen Version 1 contract',()=>{
  const old=harness(legacySource), current=harness();
  for(const h of [old,current])h.grids.MasterRoster=[['Name','Date','Shift'],['Example',new Date('2030-06-30T16:00:00Z'),'AM']];
  for(const action of ['masterroster','alldata'])assert.deepEqual(current.get(action),old.get(action));
  assert.deepEqual(current.grids,old.grids);
});
test('public catalog drift reports differences without returning stored cell values',()=>{
  for(const extraColumn of [false,true]){
    const h=harness(), marker='SYNTHETIC_PRIVATE_MARKER';
    const rows=JSON.parse(JSON.stringify(h.context.rosterV2CatalogRows_()));
    const headers=[...core.schemas.ShiftSemantics];
    if(extraColumn){headers.push('AdminNote');rows.forEach(row=>row.push(marker));}
    else rows[0][0]=marker;
    h.grids.ShiftSemantics=[headers,...rows];
    const before=structuredClone(h.grids);
    const result=h.get('rosterv2period',{period:'2030-07',mode:'shadow'});
    assert.equal(JSON.stringify(result).includes(marker),false);
    assert.equal(result.semanticCatalogStatus.headerMatch,!extraColumn);
    assert.equal(result.semanticCatalogStatus.reconciliation.match,false);
    assert.ok(result.semanticCatalogStatus.reconciliation.missingCount>0);
    assert.ok(result.semanticCatalogStatus.reconciliation.extraCount>0);
    assert.deepEqual(h.grids,before);
  }
});
