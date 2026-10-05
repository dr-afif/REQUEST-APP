import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('legacy API shapes remain unchanged and v2 diagnostics are explicit, without automatic fetches',async()=>{
  const calls=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({result:'success'})};};
  try {
    const source=fs.readFileSync(new URL('../../src/api.js',import.meta.url),'utf8')
      .replace('import.meta.env.VITE_APPS_SCRIPT_URL',JSON.stringify('https://example.invalid/test/exec'));
    const api=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
    assert.equal(calls.length,0);
    await api.fetchAllData();assert.equal(calls[0].url.searchParams.get('action'),'alldata');assert.equal(calls[0].options.method,'GET');
    await api.uploadMasterRoster([{name:'X',date:'2030-07-01',shift:'PN'}], '2030-07');
    assert.deepEqual(JSON.parse(calls[1].options.body),{action:'uploadmasterroster',rows:[{name:'X',date:'2030-07-01',shift:'PN'}],targetMonth:'2030-07'});assert.equal(calls[1].options.headers['Content-Type'],'text/plain;charset=UTF-8');
    await api.fetchRosterSchema();assert.equal(calls[2].url.searchParams.get('action'),'rosterv2schema');
    await api.fetchRosterPeriodShadow('2030-07');assert.equal(calls[3].url.searchParams.get('period'),'2030-07');assert.equal(calls[3].url.searchParams.get('mode'),'shadow');assert.equal(calls[3].options.method,'GET');
    assert.equal(calls.length,4);
  } finally {globalThis.fetch=originalFetch;}
});
