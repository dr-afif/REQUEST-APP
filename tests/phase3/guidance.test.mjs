import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import guidance from '../../src/features/roster/guidance.js';
const person='11111111-1111-4111-8111-111111111111';
const policy=(code='A',date='2030-01-07',revision=1)=>({PolicyId:crypto.randomUUID(),PolicyCode:code,EffectiveMonday:date,RuleVersion:1,RuleJson:['A','B'].includes(code)?guidance.policyRuleJson(code):'{}',Active:true,Revision:revision});
const shifts=(...raw)=>raw.map(rawShift=>({assignmentId:crypto.randomUUID(),rawShift,directoryType:rawShift.startsWith('EP_')?'EP':'MO'}));
const full=start=>guidance.weekDates(start),map=(entries={})=>Object.fromEntries(Object.entries(entries).map(([d,s])=>[d,shifts(...(Array.isArray(s)?s:[s]))]));
const evaluate=(options={})=>guidance.evaluateWeek({weekStart:'2030-07-01',personId:person,plannedByDate:{},currentByDate:{},availablePlannedDates:full('2030-07-01'),policies:[policy('A')],...options});
const codes=result=>result.issues.map(item=>item.code);

test('normal, cross-month and cross-year weeks contain exact Monday-Sunday ISO dates',()=>{
 assert.deepEqual(full('2030-07-01'),['2030-07-01','2030-07-02','2030-07-03','2030-07-04','2030-07-05','2030-07-06','2030-07-07']);
 assert.deepEqual(full('2026-06-29'),['2026-06-29','2026-06-30','2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05']);
 assert.deepEqual(full('2026-12-28'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
});
test('date engine is timezone-independent and rejects invalid labels or non-Mondays',()=>{
 assert.equal(guidance.mondayOf('2030-07-07'),'2030-07-01');assert.equal(guidance.addDays('2030-01-01',1),'2030-01-02');
 for(const bad of ['2030-02-30','0000-01-01','2030-7-1'])assert.throws(()=>guidance.mondayOf(bad));assert.throws(()=>guidance.weekDates('2030-07-02'));
});
test('month view enumerates boundary weeks without clipping dates',()=>{
 assert.deepEqual(guidance.weeksForPeriod('2026-07'),['2026-06-29','2026-07-06','2026-07-13','2026-07-20','2026-07-27']);
 assert.deepEqual(guidance.weeksForPeriod('2027-01').slice(0,2),['2026-12-28','2027-01-04']);
});
test('leap-year February arithmetic preserves the calendar label and includes February 29',()=>{assert.deepEqual(full('2028-02-28'),['2028-02-28','2028-02-29','2028-03-01','2028-03-02','2028-03-03','2028-03-04','2028-03-05']);assert.equal(guidance.addDays('2028-02-29',1),'2028-03-01');assert.throws(()=>guidance.mondayOf('2027-02-29'));});
test('incomplete adjacent period is provisional and reports no compliance or shortfall',()=>{
 const result=evaluate({availablePlannedDates:['2030-07-01','2030-07-02']});assert.equal(result.state,'PROVISIONAL');assert.equal(result.shortfall,null);assert.equal(result.requiredOff,null);assert.deepEqual(codes(result),['PROVISIONAL_WEEK']);
});
test('the same boundary week becomes complete only with all seven dates',()=>{
 const result=evaluate({plannedByDate:map({'2030-07-07':'OFF'}),currentByDate:map({'2030-07-07':'OFF'})});assert.equal(result.state,'COMPLETE');assert.equal(result.status,'COMPLETE');
});
test('cross-month Policy A and cross-year Policy B evaluate the full shared week',()=>{const aStart='2026-06-29',a=guidance.evaluateWeek({weekStart:aStart,personId:person,plannedByDate:map({'2026-07-02':'OFF'}),currentByDate:map({'2026-07-02':'OFF'}),availablePlannedDates:full(aStart),policies:[policy('A','2026-01-05')]});assert.equal(a.state,'COMPLETE');assert.equal(a.shortfall,0);
 const bStart='2030-12-30',b=guidance.evaluateWeek({weekStart:bStart,personId:person,plannedByDate:map({'2030-12-31':'NIGHT','2031-01-01':'OFF'}),currentByDate:map({'2030-12-31':'MC','2031-01-01':'OFF'}),availablePlannedDates:full(bStart),policies:[policy('B','2030-01-07')]});assert.equal(b.state,'COMPLETE');assert.equal(b.qualifyingPlannedNight,true);assert.equal(b.requiredOff,1);assert.equal(b.shortfall,0);});
test('Policy A needs one exact OFF',()=>{const yes=evaluate({plannedByDate:map({'2030-07-01':'OFF'}),currentByDate:map({'2030-07-01':'OFF'})}),no=evaluate();assert.equal(yes.shortfall,0);assert.equal(no.shortfall,1);});
test('AL MC EL GOFF HKA GHKA COURSE COURT and blank never substitute for normal OFF',()=>{
 for(const raw of ['AL','MC','EL','GOFF','HKA','GHKA','COURSE','COURT','']){const result=evaluate({plannedByDate:map({'2030-07-01':raw}),currentByDate:map({'2030-07-01':raw})});assert.equal(result.currentOperationalOff,0,raw);assert.equal(result.shortfall,1,raw);}
});
test('OFF modifiers inherit normal-OFF semantics without double counting',()=>{
 const result=evaluate({plannedByDate:map({'2030-07-01':['OFF (S)','OFF-X']}),currentByDate:map({'2030-07-01':['OFF (S)','OFF-X']})});assert.equal(result.plannedAssignedOff,1);assert.equal(result.currentOperationalOff,1);
});
for(const night of ['ON1','ON2','PN','ON','N','NIGHT'])test(`Policy B planned ${night} plus one OFF is complete`,()=>{
 const result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':night,'2030-07-02':'OFF'}),currentByDate:map({'2030-07-01':night,'2030-07-02':'OFF'})});assert.equal(result.qualifyingPlannedNight,true);assert.equal(result.requiredOff,1);assert.equal(result.shortfall,0);
});
test('Policy B without a qualifying planned night requires two OFF',()=>{
 let result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':'AM','2030-07-02':'OFF'}),currentByDate:map({'2030-07-01':'AM','2030-07-02':'OFF'})});assert.equal(result.requiredOff,2);assert.equal(result.shortfall,1);
 result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':'OFF','2030-07-02':'OFF'}),currentByDate:map({'2030-07-01':'OFF','2030-07-02':'OFF'})});assert.equal(result.shortfall,0);
});
test('GOFF beside OFF still satisfies only one normal OFF',()=>{const result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':'OFF','2030-07-02':'GOFF'}),currentByDate:map({'2030-07-01':'OFF','2030-07-02':'GOFF'})});assert.equal(result.plannedAssignedOff,1);assert.equal(result.shortfall,1);});
test('planned ON2 remains Policy-B qualifying after current MC',()=>{const result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':'ON2','2030-07-02':'OFF'}),currentByDate:map({'2030-07-01':'MC','2030-07-02':'OFF'})});assert.equal(result.qualifyingPlannedNight,true);assert.equal(result.requiredOff,1);});
test('planned OFF changed to current MC preserves planning evidence but marks OFF not taken and creates no replacement or GOFF',()=>{
 const result=evaluate({plannedByDate:map({'2030-07-01':'OFF'}),currentByDate:map({'2030-07-01':'MC'})}),day=result.outcomes[0];assert.equal(result.plannedAssignedOff,1);assert.equal(result.currentOperationalOff,0);assert.equal(result.shortfall,1);assert.deepEqual(day.currentCodes,['MC']);assert.equal(day.displacedByMc,true);assert.equal(day.currentOffTaken,false);assert.equal(day.replacementOffGenerated,0);assert.equal(day.goffGenerated,0);
});
test('planned OFF changed to current EL or AL creates no replacement OFF or GOFF',()=>{for(const current of ['EL','AL']){const result=evaluate({plannedByDate:map({'2030-07-01':'OFF'}),currentByDate:map({'2030-07-01':current})}),day=result.outcomes[0];assert.equal(result.plannedAssignedOff,1);assert.equal(result.currentOperationalOff,0);assert.deepEqual(day.currentCodes,[current]);assert.equal(day.replacementOffGenerated,0);assert.equal(day.goffGenerated,0);}});
test('MC does not satisfy an additional OFF under Policy B',()=>{const result=evaluate({policies:[policy('B')],plannedByDate:map({'2030-07-01':'OFF','2030-07-02':'MC'}),currentByDate:map({'2030-07-01':'OFF','2030-07-02':'MC'})});assert.equal(result.currentOperationalOff,1);assert.equal(result.shortfall,1);});
test('unknown planned or current semantics produces no false weekly certainty and preserves its date',()=>{
 const result=evaluate({plannedByDate:map({'2030-07-03':'MYSTERY'}),currentByDate:map({'2030-07-03':'MYSTERY'})});assert.equal(result.status,'UNKNOWN');assert.equal(result.shortfall,null);assert.equal(result.issues[0].date,'2030-07-03');
});
test('EP assignments are excluded from MO weekly entitlement',()=>{const result=evaluate({plannedByDate:map({'2030-07-01':['EP_OFFICE_HOUR','EP_ONCALL']}),currentByDate:map({'2030-07-01':['EP_OFFICE_HOUR','EP_ONCALL']})});assert.equal(result.qualifyingPlannedNight,false);assert.equal(result.shortfall,1);});
test('effective Monday is accepted, non-Monday and unsupported policies are rejected',()=>{assert.equal(guidance.normalizePolicy(policy('A','2030-01-07')).policyCode,'A');assert.throws(()=>guidance.normalizePolicy(policy('A','2030-01-08')));assert.throws(()=>guidance.normalizePolicy(policy('C')));});
test('policy selection uses the week Monday and a locked policy is immutable',()=>{
 const a=policy('A','2030-01-07',1),b=policy('B','2030-07-01',2);assert.equal(guidance.selectPolicy([a,b],'2030-06-24').policyCode,'A');assert.equal(guidance.selectPolicy([a,b],'2030-07-01').policyCode,'B');assert.equal(guidance.selectPolicy([a,b],'2030-07-01',a).policyCode,'A');
});
test('six worked calendar days are allowed and the seventh is advisory',()=>{
 const days=full('2030-07-01').map(date=>({date,assignments:shifts('AM')})),result=guidance.evaluateConsecutive({personId:person,days});assert.deepEqual(result.days.map(d=>d.count),[1,2,3,4,5,6,7]);assert.deepEqual(codes(result),['SEVENTH_WORKED_DAY']);
});
test('the consecutive-work threshold is configurable',()=>{const result=guidance.evaluateConsecutive({personId:person,threshold:2,days:['2030-07-01','2030-07-02','2030-07-03'].map(date=>({date,assignments:shifts('AM')}))});assert.deepEqual(result.days.map(day=>day.count),[1,2,3]);assert.equal(result.issues[0].threshold,2);});
test('six worked days plus transparent PN warns on the next worked calendar day',()=>{const raw=['AM','AM','AM','AM','AM','AM','PN','PM'],result=guidance.evaluateConsecutive({personId:person,days:raw.map((shift,index)=>({date:guidance.addDays('2030-07-01',index),assignments:shifts(shift)}))});assert.deepEqual(result.days.map(day=>day.count),[1,2,3,4,5,6,6,7]);assert.deepEqual(codes(result),['SEVENTH_WORKED_DAY']);assert.equal(result.issues[0].date,'2030-07-08');});
test('PN is transparent and does not increment or reset',()=>{const raw=['AM','ON1','ON2','PN','AM'],days=raw.map((s,i)=>({date:guidance.addDays('2030-07-01',i),assignments:shifts(s)})),result=guidance.evaluateConsecutive({personId:person,days});assert.deepEqual(result.days.map(d=>d.count),[1,2,3,3,4]);assert.equal(result.days[3].behavior,'TRANSPARENT');});
test('reset statuses clear the consecutive sequence',()=>{for(const reset of ['OFF','GOFF','AL','MC','EL','HKA','GHKA','COURSE','']){const result=guidance.evaluateConsecutive({personId:person,days:[{date:'2030-07-01',assignments:shifts('AM')},{date:'2030-07-02',assignments:shifts(reset)},{date:'2030-07-03',assignments:shifts('PM')}]});assert.deepEqual(result.days.map(d=>d.count),[1,0,1],reset);}});
test('AM+PM and AM+PN remain multiple assignments but count once per date',()=>{for(const pair of [['AM','PM'],['AM','PN']]){const day={date:'2030-07-01',assignments:shifts(...pair)},result=guidance.evaluateConsecutive({personId:person,days:[day]});assert.equal(day.assignments.length,2);assert.equal(result.days[0].count,1);}});
test('consecutive evaluation crosses month and year boundaries',()=>{for(const start of ['2030-07-29','2030-12-30']){const result=guidance.evaluateConsecutive({personId:person,days:full(start).map(date=>({date,assignments:shifts('AM')}))});assert.equal(result.days.at(-1).count,7);assert.equal(result.issues.length,1);}});
test('unknown consecutive semantics stays indeterminate until a reset',()=>{const result=guidance.evaluateConsecutive({personId:person,days:[{date:'2030-07-01',assignments:shifts('AM')},{date:'2030-07-02',assignments:shifts('???')},{date:'2030-07-03',assignments:shifts('PN')},{date:'2030-07-04',assignments:shifts('OFF')},{date:'2030-07-05',assignments:shifts('AM')}]});assert.deepEqual(result.days.map(d=>d.count),[1,null,null,0,1]);assert.deepEqual(codes(result),['UNKNOWN_SEMANTIC']);});
const night=(raw,start='2030-07-01')=>guidance.evaluateNightSafety({personId:person,days:raw.map((s,i)=>({date:guidance.addDays(start,i),assignments:shifts(...(Array.isArray(s)?s:[s]))}))});
test('ON1 ON2 PN is a valid full bundle',()=>assert.deepEqual(codes(night(['ON1','ON2','PN'])),[]));
test('ON1 PN is a valid abbreviated bundle',()=>assert.deepEqual(codes(night(['ON1','PN'])),[]));
for(const raw of ['ON','N','NIGHT'])test(`legacy ${raw} PN is valid without conversion`,()=>{const result=night([raw,'PN']);assert.deepEqual(codes(result),[]);assert.equal(result.days[0].baseCodes[0],raw);});
test('night bundles validate across month and year boundaries',()=>{assert.deepEqual(codes(night(['ON1','ON2','PN'],'2030-06-30')),[]);assert.deepEqual(codes(night(['ON1','PN'],'2030-12-31')),[]);});
test('ON1 ON2 does not create false rest warning',()=>{const result=night(['ON1','ON2']);assert(!codes(result).includes('INSUFFICIENT_POST_NIGHT_REST'));assert(codes(result).includes('NIGHT_BUNDLE_FOLLOWER'));});
test('worked continuation after ON2 produces bundle and rest issues',()=>{const result=night(['ON1','ON2','AM']);assert(codes(result).includes('NIGHT_BUNDLE_FOLLOWER'));assert(codes(result).includes('INSUFFICIENT_POST_NIGHT_REST'));});
test('protected reset after night produces bundle warning without rest warning',()=>{for(const reset of ['OFF','GOFF','MC','AL']){const result=night(['ON2',reset]);assert(codes(result).includes('NIGHT_BUNDLE_FOLLOWER'));assert(!codes(result).includes('INSUFFICIENT_POST_NIGHT_REST'),reset);}});
test('isolated PN and ON2 predecessor anomalies remain distinct',()=>{assert(codes(night(['PN'])).includes('NIGHT_BUNDLE_PREDECESSOR'));assert(codes(night(['ON2','PN'])).includes('NIGHT_BUNDLE_PREDECESSOR'));});
test('PN plus a worked continuation does not conceal insufficient rest',()=>{const result=night(['ON2',['PN','AM']]);assert(codes(result).includes('INSUFFICIENT_POST_NIGHT_REST'));});
test('unknown night context stays explicit while EP pairs remain outside MO night and consecutive guidance',()=>{const unknown=night(['ON2','MYSTERY']);assert(codes(unknown).includes('UNKNOWN_SEMANTIC'));assert(!codes(unknown).includes('INSUFFICIENT_POST_NIGHT_REST'));
 const days=[{date:'2030-07-01',assignments:shifts('EP_OFFICE_HOUR','EP_ONCALL')}];assert.deepEqual(codes(guidance.evaluateNightSafety({personId:person,days})),[]);assert.deepEqual(guidance.evaluateConsecutive({personId:person,days}).days,[{date:'2030-07-01',count:0,behavior:'EXCLUDED'}]);});
test('missing adjacent sequence context is provisional and produces no partial night or consecutive result',()=>{const result=guidance.evaluateSequences({personId:person,days:[{date:'2030-07-31',assignments:shifts('ON2')}],completeContext:false,contextKey:'2030-07'});assert.equal(result.consecutive,null);assert.equal(result.night,null);assert.deepEqual(codes(result),['INCOMPLETE_SEQUENCE_CONTEXT']);assert.match(result.issues[0].id,/2030-07$/);});
test('acknowledgement preserves warning identity and changes review state only',()=>{const result=night(['ON2','AM']),item=result.issues[0],record=guidance.acknowledgeIssue(item,{at:'2030-01-01T00:00:00.000Z'}),reviewed=night(['ON2','AM']);const applied=guidance.evaluateNightSafety({personId:person,days:[{date:'2030-07-01',assignments:shifts('ON2')},{date:'2030-07-02',assignments:shifts('AM')}],acknowledgements:[record]});assert.equal(record.issueId,item.id);assert(applied.issues.some(i=>i.id===item.id&&i.acknowledged));assert.equal(reviewed.issues.length,applied.issues.length);});
test('policy write switches are strict and all three are required',()=>{assert(guidance.policyWritesEnabled({weekly_off_guidance_enabled:true,roster_v2_write_enabled:true,write_queue_v2_enabled:true}));for(const key of ['weekly_off_guidance_enabled','roster_v2_write_enabled','write_queue_v2_enabled']){const flags={weekly_off_guidance_enabled:true,roster_v2_write_enabled:true,write_queue_v2_enabled:true,[key]:'false'};assert.equal(guidance.policyWritesEnabled(flags),false);}});
test('policy operation validates Monday, ISO date, identity, revision and exact fields',()=>{const op={operationId:crypto.randomUUID(),clientId:crypto.randomUUID(),tabId:crypto.randomUUID(),operationType:'OFF_POLICY_UPSERT',entityKey:'off-policies',expectedRevision:0,payload:{policyId:crypto.randomUUID(),policyCode:'A',effectiveMonday:'2030-01-07',reason:'Initial'}};assert.deepEqual(guidance.policyOperation(op).payload,op.payload);for(const change of [o=>o.payload.effectiveMonday='2030-01-08',o=>o.payload.effectiveMonday='2030-02-30',o=>o.payload.policyCode='C',o=>o.payload.policyId='bad',o=>o.expectedRevision=-1,o=>o.payload.extra=true]){const bad=structuredClone(op);change(bad);assert.throws(()=>guidance.policyOperation(bad));}});
test('policy RuleJson is deterministic and records semantic planning basis',()=>{const parsed=JSON.parse(guidance.policyRuleJson('B'));assert.equal(parsed.policyCode,'B');assert.equal(parsed.normalOffBaseCode,'OFF');assert.equal(parsed.nightQualification,'PUBLISHED_PLANNED_SHIFT_SEMANTICS');assert.throws(()=>guidance.policyRuleJson('C'));});
