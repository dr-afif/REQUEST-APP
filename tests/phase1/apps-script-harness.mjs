import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
export const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/legacy-workbook.json', import.meta.url), 'utf8'));
export const legacySource = fs.readFileSync(new URL('../fixtures/legacy-appscript-v1.txt', import.meta.url), 'utf8');
export const currentSource = fs.readFileSync(new URL('../../appscript.txt', import.meta.url), 'utf8');
export const digest = text => crypto.createHash('sha256').update(text).digest('hex');
export function harness(source = currentSource, { tables = fixture.tables, activeEmail = '', adminEmail = '', effectiveEmail = 'owner@example.invalid', failLock = false } = {}) {
  const grids = structuredClone(tables), writes = [], locks = [];
  const blank = v => v === '' || v === undefined || v === null;
  function sheet(name) {
    const lastRow = () => Math.max(0, ...grids[name].map((row,i) => row.some(v => !blank(v)) ? i+1 : 0));
    const lastColumn = () => Math.max(0,...grids[name].map(row => Math.max(0,...row.map((v,i) => blank(v) ? 0 : i+1))));
    function range(r,c,nr=1,nc=1) {
      const values = () => Array.from({length:nr},(_,y) => Array.from({length:nc},(_,x) => grids[name][r-1+y]?.[c-1+x] ?? ''));
      const api = {
        getValues: () => structuredClone(values()),
        getDisplayValues: () => values().map(row => row.map(v => Object.prototype.toString.call(v) === '[object Date]' ? v.toISOString() : String(v))),
        setValues: data => { if (data.length!==nr || data.some(row=>row.length!==nc)) throw Error('Invalid range dimensions');
          writes.push({name,method:'setValues',r,c,data:JSON.parse(JSON.stringify(data))});
          data.forEach((row,y)=>row.forEach((v,x)=>{grids[name][r-1+y] ||= []; grids[name][r-1+y][c-1+x]=v;})); return api; },
        setValue: value => api.setValues([[value]]),
        clearContent: () => { writes.push({name,method:'clearContent',r,c,nr,nc}); for(let y=0;y<nr;y++)for(let x=0;x<nc;x++){grids[name][r-1+y] ||= [];grids[name][r-1+y][c-1+x]='';}return api; },
        setNumberFormat: format => { writes.push({name,method:'setNumberFormat',r,c,format});return api; },
      }; return api;
    }
    return { getDataRange:()=>range(1,1,Math.max(lastRow(),1),Math.max(lastColumn(),1)), getRange:range,
      getLastRow:lastRow,getLastColumn:lastColumn,
      appendRow:row=>{writes.push({name,method:'appendRow',row:JSON.parse(JSON.stringify(row))});grids[name][lastRow()]=row;},
      deleteRow:r=>{writes.push({name,method:'deleteRow',r});grids[name].splice(r-1,1);} };
  }
  const NativeDate=Date;
  class ClockDate extends NativeDate { constructor(...args){super(...(args.length ? args : ['2030-09-07T08:00:00.000Z']));}static now(){return NativeDate.parse('2030-09-07T08:00:00.000Z');} }
  const context=vm.createContext({Date:ClockDate, console,
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:name=>Object.hasOwn(grids,name)?sheet(name):null,
      insertSheet:name=>{writes.push({name,method:'insertSheet'});grids[name]=[];return sheet(name);}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    LockService:{getScriptLock:()=>({waitLock:()=>{locks.push('acquire');if(failLock)throw Error('Lock unavailable');},releaseLock:()=>locks.push('release')})},
    Session:{getScriptTimeZone:()=> 'Asia/Singapore',getActiveUser:()=>({getEmail:()=>activeEmail}),getEffectiveUser:()=>({getEmail:()=>effectiveEmail})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='ROSTER_V2_ADMIN_EMAIL'?adminEmail:null})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA-256'},Charset:{UTF_8:'UTF-8'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],formatDate:date=>new NativeDate(date.getTime()+28800000).toISOString().slice(0,10)},
  });
  vm.runInContext(source,context,{timeout:5000});
  return { context, grids,writes,locks,
    get:(action,parameters={})=>JSON.parse(context.doGet({parameter:{action,...parameters}}).text),
    post:payload=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(payload)}}).text),
    jsonState:()=>JSON.parse(JSON.stringify(grids)),
    core:()=>vm.runInContext('RosterCompatibility',context),
  };
}
