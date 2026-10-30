import vm from 'node:vm';
import {harness,currentSource} from '../phase1/apps-script-harness.mjs';
import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import puppeteer from 'puppeteer-core';import {build} from 'esbuild';
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser,page,origin,backend,dropResponse=false;
before(async()=>{
 const ui=await build({entryPoints:[path.join(root,'tests/phase2/ui-fixture.jsx')],bundle:true,write:false,format:'esm',jsx:'automatic',define:{'import.meta.env':'{}'}});

 server=http.createServer((req,res)=>{
   if(req.url.startsWith('/__backend')){const url=new URL(req.url,'http://127.0.0.1');let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
     try{const result=req.method==='POST'?backend.post(JSON.parse(body)):backend.get(url.searchParams.get('action'),Object.fromEntries(url.searchParams));
       if(dropResponse&&req.method==='POST'){dropResponse=false;res.setHeader('Content-Type','application/json');res.end('{');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
     }catch{res.writeHead(500);res.end();}});return;}
if(req.url==='/__ui.js'){res.setHeader('Content-Type','text/javascript');res.end(ui.outputFiles[0].text);return;}let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(req.url!=='/'&&!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local Phase 2 verification</title>');return;}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const executable=process.env.PHASE2_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
 if(!executable)throw Error('Set PHASE2_BROWSER_PATH to a Chromium browser for required real IndexedDB tests.');
 browser=await puppeteer.launch({executablePath:executable,headless:true,args:['--disable-background-networking','--no-first-run']});page=await browser.newPage();
 page.on('dialog',dialog=>dialog.accept()); // Permit navigation after an intentionally failed durability regression.
 await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);
}, {timeout:30000});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
// Named cases execute the real IndexedDB, Web Locks and BroadcastChannel implementations.
const names=Object.keys((await import('./browser-cases.js')).cases);
for(const name of names)test(name,{timeout:15000},async()=>{
 const error=await page.evaluate(async name=>{try{const {cases}=await import('/tests/phase2/browser-cases.js');await cases[name]();return null;}catch(e){return e.stack||e.message;}},name);assert.equal(error,null);
});


test('real page reload retains outbox records and baseline in IndexedDB',{timeout:15000},async()=>{
 const name='reload-'+crypto.randomUUID();
 await page.evaluate(async name=>{const {setup}=await import('/tests/phase2/browser-cases.js');const a=await setup({name});await a.q.enqueue('draft:2030-07',[{personId:'11111111-1111-4111-8111-111111111111',date:'2030-07-01',assignments:[{assignmentId:crypto.randomUUID(),rawShift:'PN'}]}]);a.close();},name);
 await page.reload();const result=await page.evaluate(async name=>{const {IndexedOutbox}=await import('/src/features/roster/queue/indexedOutbox.js');const db=await IndexedOutbox.open({name});const e=await db.read('draft:2030-07');db.close();return [e.operations[0].status,e.operations[0].payload.patches[0].assignments[0].rawShift,e.baseline.revision];},name);
 assert.deepEqual(result,['QUEUED','PN',0]);
});
test('minimal editor queues typed assignments, displays per-cell pending state and survives confirmation',{timeout:15000},async()=>{
 await page.reload();await page.evaluate(async()=>{await import('/__ui.js');await window.mountDraftTest();});
 await page.waitForFunction(()=>document.querySelector('textarea')&&!document.querySelector('textarea').disabled);
 await page.type('textarea','AM\nPM');
 await page.waitForFunction(()=>document.querySelector('table')?.textContent.includes('AM + PM'));
 await page.waitForFunction(()=>document.querySelector('table')?.textContent.includes('Queued'));
 assert.match(await page.$eval('table',e=>e.textContent),/Queued/);
 assert.match(await page.$eval('[role=status]',e=>e.textContent),/confirmation/);
 await page.evaluate(async()=>{window.draftTest.advance();await window.draftTest.q.tick();});
 await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('All changes saved'));
 assert.match(await page.$eval('table',e=>e.textContent),/Saved/);await page.evaluate(()=>window.unmountDraftTest());
});

function resetBackend(){backend=harness(currentSource,{activeEmail:'admin@example.invalid',adminEmail:'admin@example.invalid'});backend.context.SpreadsheetApp.flush=()=>{};
 backend.grids.Settings.push(['roster_v2_write_enabled','true'],['write_queue_v2_enabled','true']);
 backend.grids.RosterPeriods=[['PeriodId','SchemaVersion','EnrolledAt','EnrolledBy'],['2030-07',2,'2030-01-01','owner']];
 backend.grids.RosterPeople=[['PersonId','DirectoryType','CurrentDisplayName','LegacyNamesJson','Active'],['11111111-1111-4111-8111-111111111111','MO','Example','[]',true]];
 for(const [name,headers]of Object.entries(vm.runInContext('ROSTER_DRAFT_SCHEMAS',backend.context)))backend.grids[name]=[[...headers]];
}
async function peer(tab,name){await tab.evaluate(async({name,origin})=>{
 const {IndexedOutbox}=await import('/src/features/roster/queue/indexedOutbox.js');const {DraftQueue}=await import('/src/features/roster/queue/draftQueue.js');const {createDraftRepository}=await import('/src/features/roster/data/draftRepository.js');
 const store=await IndexedOutbox.open({name});window.peerClock=0;window.peerQueue=new DraftQueue({store,repository:createDraftRepository({baseUrl:origin+'/__backend'}),settings:{roster_v2_write_enabled:true,write_queue_v2_enabled:true},now:()=>window.peerClock});
 window.peerQueue.clientId=await store.clientId();await window.peerQueue.refresh('draft:2030-07');
 window.editPeer=async rawShift=>window.peerQueue.enqueue('draft:2030-07',[{personId:'11111111-1111-4111-8111-111111111111',date:'2030-07-01',assignments:[{assignmentId:crypto.randomUUID(),rawShift}]}]);
 window.tickPeer=async()=>{window.peerClock+=100000;await window.peerQueue.tick();return window.peerQueue.view('draft:2030-07').operations[0].status;};
 },{name,origin});}
test('two actual tabs use distinct TabIds and the generated Apps Script rejects the stale client',{timeout:15000},async()=>{
 resetBackend();await page.reload();const second=await browser.newPage();await second.setRequestInterception(true);second.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());await second.goto(origin);
 try{await peer(page,'actual-a-'+crypto.randomUUID());await peer(second,'actual-b-'+crypto.randomUUID());assert.notEqual(await page.evaluate(()=>peerQueue.tabId),await second.evaluate(()=>peerQueue.tabId));
 await page.evaluate(()=>editPeer('AM'));await second.evaluate(()=>editPeer('PM'));assert.equal(await page.evaluate(()=>tickPeer()),'CONFIRMED');assert.equal(await second.evaluate(()=>tickPeer()),'CONFLICT');
 assert.equal(backend.grids.RosterDraftPatches.length,2);assert.equal(backend.get('rosterv2draft',{entityKey:'draft:2030-07'}).cells['11111111-1111-4111-8111-111111111111/2030-07-01'][0].rawShift,'AM');
 }finally{await second.close();}
});
test('real HTTP response loss after generated Apps Script confirmation recovers by status without duplicate writes',{timeout:15000},async()=>{
 resetBackend();await page.reload();const name='http-loss-'+crypto.randomUUID();await peer(page,name);await page.evaluate(()=>editPeer('PN'));dropResponse=true;
 assert.equal(await page.evaluate(()=>tickPeer()),'AWAITING_STATUS');assert.equal(backend.grids.RosterDraftPatches.length,2);
 await page.reload();await peer(page,name);await page.evaluate(()=>{peerClock=peerQueue.view('draft:2030-07').operations[0].nextRetryAt;});assert.equal(await page.evaluate(()=>tickPeer()),'CONFIRMED');assert.equal(backend.grids.OperationLog.length,2);assert.equal(backend.grids.RosterDraftPatches.length,2);
});

test('review: unmount during delayed schema does not start a stale refresh or timer',{timeout:15000},async()=>{
 await page.reload();await page.evaluate(async()=>{await import('/__ui.js');await window.mountDraftTest({holdSchema:true});});
 await page.waitForFunction(()=>window.draftTest.q.timer!==null);
 const result=await page.evaluate(async()=>{window.unmountDraftTest(false);window.draftTest.releaseSchema();await new Promise(r=>setTimeout(r,50));const reads=window.draftTest.readCount;window.draftTest.close();return reads;});assert.equal(result,0);
});

test('review: reverting the proposal updates both the cell table and editable text',{timeout:15000},async()=>{
 await page.reload();await page.evaluate(async()=>{await import('/__ui.js');await window.mountDraftTest();});await page.waitForFunction(()=>document.querySelector('textarea')&&!document.querySelector('textarea').disabled);
 await page.type('textarea','AM');await page.waitForFunction(()=>window.draftTest.q.view('draft:2030-07').operations.length===1&&window.draftTest.q.unsafe.size===0);
 await page.evaluate(async()=>{const q=window.draftTest.q;await q.revert('draft:2030-07',q.view('draft:2030-07').operations[0].operationId);});
 await page.waitForFunction(()=>!document.querySelector('table').textContent.includes('AM'));assert.equal(await page.$eval('textarea',e=>e.value),'');await page.evaluate(()=>window.unmountDraftTest());
});
