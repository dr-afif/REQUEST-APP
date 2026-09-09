import RosterCompatibility from './compatibility.js';

// Pure Phase 3 advisory contract. Dates are calendar labels and never local Date objects.
const RosterGuidance = (() => {
  const OFF_POLICY_HEADERS = ['PolicyId','PolicyCode','EffectiveMonday','RuleVersion','RuleJson','Active','Reason','Revision','OperationId','CreatedAt','CreatedBy'];
  const issueCodes = Object.freeze(['PROVISIONAL_WEEK','WEEKLY_OFF_SHORTFALL','UNKNOWN_SEMANTIC','SEVENTH_WORKED_DAY',
    'NIGHT_BUNDLE_PREDECESSOR','NIGHT_BUNDLE_FOLLOWER','INSUFFICIENT_POST_NIGHT_REST','INCOMPLETE_SEQUENCE_CONTEXT']);
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    RosterCompatibility.localDate(value) === value && value.slice(0,4) !== '0000';
  const stamp = value => Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1,Number(value.slice(8,10)));
  const addDays = (value,days) => {
    if(!iso(value)||!Number.isInteger(days))throw new Error('INVALID_DATE');
    return new Date(stamp(value)+days*86400000).toISOString().slice(0,10);
  };
  const weekday = value => { if(!iso(value))throw new Error('INVALID_DATE');return new Date(stamp(value)).getUTCDay(); };
  const mondayOf = value => addDays(value,-((weekday(value)+6)%7));
  const weekDates = weekStart => {
    if(weekday(weekStart)!==1)throw new Error('POLICY_DATE_NOT_MONDAY');
    return Array.from({length:7},(_,i)=>addDays(weekStart,i));
  };
  const periodDates = period => {
    RosterCompatibility.validatePeriod(period);let value=period+'-01',dates=[];
    while(value.slice(0,7)===period){dates.push(value);value=addDays(value,1);}return dates;
  };
  const weeksForPeriod = period => [...new Set(periodDates(period).map(mondayOf))];
  const normalizePolicy = policy => {
    if(!policy||!uuid(policy.PolicyId)||!['A','B'].includes(policy.PolicyCode)||!iso(policy.EffectiveMonday)||weekday(policy.EffectiveMonday)!==1||
      Number(policy.RuleVersion)!==1||policy.RuleJson!==policyRuleJson(policy.PolicyCode)||policy.Active===false||String(policy.Active).toUpperCase()==='FALSE')throw new Error('INVALID_OFF_POLICY');
    return {policyId:policy.PolicyId,policyCode:policy.PolicyCode,effectiveMonday:policy.EffectiveMonday,ruleVersion:1,ruleJson:policy.RuleJson,revision:Number(policy.Revision)||0};
  };
  function selectPolicy(policies,weekStart,lockedPolicy=null) {
    weekDates(weekStart);
    if(lockedPolicy)return {...normalizePolicy(lockedPolicy),locked:true};
    const eligible=policies.map(normalizePolicy).filter(p=>p.effectiveMonday<=weekStart)
      .sort((a,b)=>a.effectiveMonday.localeCompare(b.effectiveMonday)||a.revision-b.revision);
    if(!eligible.length)throw new Error('OFF_POLICY_NOT_FOUND');
    return {...eligible.at(-1),locked:false};
  }
  const assignments = value => Array.isArray(value)?value:[];
  const semantics = value => assignments(value).map(item=>typeof item==='string'?RosterCompatibility.resolveShift(item):
    RosterCompatibility.resolveShift(item.rawShift,item.directoryType||'MO')).filter(item=>item.moApplicable!==false);
  const issue = (code,fields={}) => ({id:[code,fields.personId,fields.date||fields.weekStart||fields.contextKey].filter(Boolean).join(':'),code,severity:'ADVISORY',...fields});
  const acknowledged = (item,records=[]) => ({...item,acknowledged:records.some(record=>record.issueId===item.id&&record.acknowledged===true)});
  function evaluateWeek({weekStart,personId,plannedByDate={},currentByDate=plannedByDate,availablePlannedDates=[],policies=[],lockedPolicy=null,acknowledgements=[]}) {
    if(!uuid(personId))throw new Error('INVALID_PERSON');
    const dates=weekDates(weekStart),available=new Set(availablePlannedDates),policy=selectPolicy(policies,weekStart,lockedPolicy);
    if(dates.some(date=>!available.has(date))){const item=acknowledged(issue('PROVISIONAL_WEEK',{personId,weekStart,dates}),acknowledgements);
      return {personId,weekStart,weekEnd:dates.at(-1),state:'PROVISIONAL',complete:false,policy,qualifyingPlannedNight:null,
        requiredOff:null,plannedAssignedOff:null,currentOperationalOff:null,shortfall:null,status:'INCOMPLETE',outcomes:[],issues:[item]};}
    const planned=dates.map(date=>semantics(plannedByDate[date])),current=dates.map(date=>semantics(currentByDate[date]));
    const unknownDates=dates.filter((date,i)=>[...planned[i],...current[i]].some(s=>s.consecutive==='UNKNOWN'||s.moApplicable===null));
    if(unknownDates.length){const issues=unknownDates.map(date=>acknowledged(issue('UNKNOWN_SEMANTIC',{personId,date,weekStart}),acknowledgements));
      return {personId,weekStart,weekEnd:dates.at(-1),state:'INCOMPLETE',complete:false,policy,qualifyingPlannedNight:null,
        requiredOff:null,plannedAssignedOff:null,currentOperationalOff:null,shortfall:null,status:'UNKNOWN',outcomes:[],issues};}
    const qualifyingPlannedNight=planned.some(day=>day.some(s=>s.policyBQualifier===true));
    const requiredOff=policy.policyCode==='A'||qualifyingPlannedNight?1:2;
    const plannedAssignedOff=planned.filter(day=>day.some(s=>s.normalOff===true)).length;
    const currentOperationalOff=current.filter(day=>day.some(s=>s.normalOff===true)).length;
    const outcomes=dates.map((date,i)=>{const plannedOff=planned[i].some(s=>s.normalOff),currentOff=current[i].some(s=>s.normalOff);
      const currentCodes=current[i].map(s=>s.baseCode),displacedByMc=plannedOff&&!currentOff&&currentCodes.includes('MC');
      return {date,plannedOff,currentOffTaken:currentOff,currentCodes,displacedByMc,replacementOffGenerated:0,goffGenerated:0};});
    const shortfall=Math.max(0,requiredOff-currentOperationalOff),issues=[];
    if(shortfall)issues.push(acknowledged(issue('WEEKLY_OFF_SHORTFALL',{personId,weekStart,shortfall}),acknowledgements));
    return {personId,weekStart,weekEnd:dates.at(-1),state:'COMPLETE',complete:true,policy,qualifyingPlannedNight,requiredOff,
      plannedAssignedOff,currentOperationalOff,shortfall,status:shortfall?'SHORTFALL':'COMPLETE',outcomes,issues};
  }
  function evaluateConsecutive({personId,days,threshold=6,acknowledgements=[]}) {
    if(!uuid(personId)||!Number.isInteger(threshold)||threshold<1||!Array.isArray(days))throw new Error('INVALID_CONSECUTIVE_INPUT');
    let count=0,previous=null;const results=[],issues=[];
    for(const day of [...days].sort((a,b)=>a.date.localeCompare(b.date))){
      if(!iso(day.date)||previous&&addDays(previous,1)!==day.date)throw new Error('NON_CONTIGUOUS_DATES');previous=day.date;
      const classification=RosterCompatibility.classifyCalendarDay(assignments(day.assignments));
      if(classification.behavior==='UNKNOWN'){count=null;const item=acknowledged(issue('UNKNOWN_SEMANTIC',{personId,date:day.date}),acknowledgements);issues.push(item);results.push({date:day.date,count:null,behavior:'UNKNOWN'});continue;}
      if(count===null){if(classification.behavior==='RESET')count=0;else{results.push({date:day.date,count:null,behavior:classification.behavior});continue;}}
      count=RosterCompatibility.advanceWorkedDays(count,classification);results.push({date:day.date,count,behavior:classification.behavior});
      if(classification.behavior==='INCREMENT'&&count>threshold)issues.push(acknowledged(issue('SEVENTH_WORKED_DAY',{personId,date:day.date,count,threshold}),acknowledgements));
    }
    return {personId,threshold,days:results,issues};
  }
  function evaluateNightSafety({personId,days,acknowledgements=[]}) {
    if(!uuid(personId)||!Array.isArray(days))throw new Error('INVALID_NIGHT_INPUT');
    const ordered=[...days].sort((a,b)=>a.date.localeCompare(b.date));
    for(let i=1;i<ordered.length;i++)if(addDays(ordered[i-1].date,1)!==ordered[i].date)throw new Error('NON_CONTIGUOUS_DATES');
    const resolved=ordered.map(day=>({date:day.date,items:semantics(day.assignments)})),issues=[];
    const has=(day,code)=>day?.items.some(s=>s.baseCode===code),worked=day=>day?.items.some(s=>s.worked===true),unknown=day=>day?.items.some(s=>s.consecutive==='UNKNOWN');
    const add=(code,date,details={})=>issues.push(acknowledged(issue(code,{personId,date,...details}),acknowledgements));
    resolved.forEach((day,index)=>{
      if(unknown(day)){add('UNKNOWN_SEMANTIC',day.date);return;}
      const previous=resolved[index-1],next=resolved[index+1],codes=[...new Set(day.items.map(s=>s.baseCode))];
      if(codes.includes('PN')&&!previous?.items.some(s=>s.expectedFollowers.includes('PN')))add('NIGHT_BUNDLE_PREDECESSOR',day.date,{expected:'NIGHT'});
      for(const code of codes.filter(value=>['ON1','ON2','ON','N','NIGHT'].includes(value))){
        if(code==='ON2'&&!has(previous,'ON1'))add('NIGHT_BUNDLE_PREDECESSOR',day.date,{expected:'ON1'});
        const validNext=code==='ON1'?(has(next,'ON2')||has(next,'PN')):has(next,'PN');
        if(!validNext)add('NIGHT_BUNDLE_FOLLOWER',day.date,{expected:code==='ON1'?'ON2_OR_PN':'PN'});
        const bundleContinuation=code==='ON1'&&has(next,'ON2');
        if(!bundleContinuation&&worked(next))add('INSUFFICIENT_POST_NIGHT_REST',next.date,{after:day.date});
      }
    });
    return {personId,days:resolved.map(day=>({date:day.date,baseCodes:day.items.map(s=>s.baseCode)})),issues};
  }
  function evaluateSequences({personId,days,threshold=6,completeContext=true,contextKey='',acknowledgements=[]}) {
    if(!completeContext){const item=acknowledged(issue('INCOMPLETE_SEQUENCE_CONTEXT',{personId,contextKey}),acknowledgements);
      return {personId,completeContext:false,consecutive:null,night:null,issues:[item]};}
    const consecutive=evaluateConsecutive({personId,days,threshold,acknowledgements});
    const night=evaluateNightSafety({personId,days,acknowledgements});
    return {personId,completeContext:true,consecutive,night,issues:[...consecutive.issues,...night.issues]};
  }
  const policyRuleJson = policyCode => {
    if(!['A','B'].includes(policyCode))throw new Error('INVALID_OFF_POLICY');
    return JSON.stringify({policyCode,ruleVersion:1,normalOffBaseCode:'OFF',nightQualification:'PUBLISHED_PLANNED_SHIFT_SEMANTICS'});
  };
  const acknowledgeIssue = (item,{actor='ADMIN',at=new Date().toISOString()}={}) => ({issueId:item.id,issueCode:item.code,acknowledged:true,actor,acknowledgedAt:at});
  function policyOperation(operation) {
    if(!operation||!uuid(operation.operationId)||!uuid(operation.clientId)||!uuid(operation.tabId)||operation.operationType!=='OFF_POLICY_UPSERT'||
      operation.entityKey!=='off-policies'||!Number.isSafeInteger(operation.expectedRevision)||operation.expectedRevision<0)throw new Error('VALIDATION_FAILED');
    const p=operation.payload;if(!p||Object.keys(p).sort().join(',')!=='effectiveMonday,policyCode,policyId,reason'||!uuid(p.policyId)||
      !['A','B'].includes(p.policyCode)||!iso(p.effectiveMonday)||weekday(p.effectiveMonday)!==1||typeof p.reason!=='string'||p.reason.length>500)throw new Error('VALIDATION_FAILED');
    return {operationType:'OFF_POLICY_UPSERT',entityKey:'off-policies',expectedRevision:operation.expectedRevision===0?0:operation.expectedRevision,
      payload:{policyId:p.policyId,policyCode:p.policyCode,effectiveMonday:p.effectiveMonday,reason:p.reason}};
  }
  const policyWritesEnabled = settings => {const f=RosterCompatibility.featureSwitches(settings);return f.weekly_off_guidance_enabled&&f.roster_v2_write_enabled&&f.write_queue_v2_enabled;};
  return Object.freeze({OFF_POLICY_HEADERS,issueCodes,uuid,iso,addDays,weekday,mondayOf,weekDates,periodDates,weeksForPeriod,normalizePolicy,
    selectPolicy,evaluateWeek,evaluateConsecutive,evaluateNightSafety,evaluateSequences,policyRuleJson,acknowledgeIssue,policyOperation,policyWritesEnabled});
})();

export default RosterGuidance;
