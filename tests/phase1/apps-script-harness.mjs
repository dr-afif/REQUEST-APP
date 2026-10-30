import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
export const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/legacy-workbook.json', import.meta.url), 'utf8'));
export const legacySource = fs.readFileSync(new URL('../fixtures/legacy-appscript-v1.txt', import.meta.url), 'utf8');
export const currentSource = fs.readFileSync(new URL('../../appscript.txt', import.meta.url), 'utf8');
export const digest = text => crypto.createHash('sha256').update(text).digest('hex');
export function harness(source = currentSource, { tables = fixture.tables, activeEmail = '', adminEmail = '', effectiveEmail = 'owner@example.invalid', sessionSecret = '', adminPin = '', clockIso = '2030-09-07T08:00:00.000Z', failLock = false, coerceDates = false, appEnvironment = '', scriptProperties = {} } = {}) {
  const grids = structuredClone(tables), writes = [], locks = [];
  const blank = v => v === '' || v === undefined || v === null;
  const colFormats = {};
  const NativeDate = Date;
  const coerceVal = (tblName, colIdx, v) => {
    if (!coerceDates) return v;
    const format = colFormats[tblName + ':' + colIdx];
    if (format === '@') return v;
    if (typeof v === 'string') {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) {
        const [y, m] = v.split('-').map(Number);
        return new NativeDate(Date.UTC(y, m - 1, 1) - 28800000);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        return new NativeDate(Date.UTC(y, m - 1, d) - 28800000);
      }
    }
    return v;
  };
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
          data.forEach((row,y)=>row.forEach((v,x)=>{grids[name][r-1+y] ||= []; grids[name][r-1+y][c-1+x]=coerceVal(name, c+x, v);})); return api; },
        setValue: value => api.setValues([[value]]),
        clearContent: () => { writes.push({name,method:'clearContent',r,c,nr,nc}); for(let y=0;y<nr;y++)for(let x=0;x<nc;x++){grids[name][r-1+y] ||= [];grids[name][r-1+y][c-1+x]='';}return api; },
        setNumberFormat: format => { writes.push({name,method:'setNumberFormat',r,c,format}); for(let x=0;x<nc;x++){ colFormats[name + ':' + (c+x)] = format; } return api; },
      }; return api;
    }
    return { getDataRange:()=>range(1,1,Math.max(lastRow(),1),Math.max(lastColumn(),1)), getRange:range,
      getLastRow:lastRow,getLastColumn:lastColumn,
      appendRow:row=>{writes.push({name,method:'appendRow',row:JSON.parse(JSON.stringify(row))}); const coercedRow = row.map((v, i) => coerceVal(name, i + 1, v)); grids[name][lastRow()]=coercedRow;},
      deleteRow:r=>{writes.push({name,method:'deleteRow',r});grids[name].splice(r-1,1);} };
  }
  class ClockDate extends NativeDate { constructor(...args){super(...(args.length ? args : [clockIso]));}static now(){return NativeDate.parse(clockIso);} }
  const inMemCache = new Map();
  const context=vm.createContext({Date:ClockDate, console,
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getId:()=>'mock-spreadsheet-id',getName:()=>'REQUEST-APP Staging Test',getSpreadsheetTimeZone:()=>'Asia/Kuala_Lumpur',getSheetByName:name=>Object.hasOwn(grids,name)?sheet(name):null,
      insertSheet:name=>{writes.push({name,method:'insertSheet'});grids[name]=[];return sheet(name);}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,getContent:()=>text,setMimeType(){return this;}})},
    LockService:{getScriptLock:()=>({waitLock:()=>{locks.push('acquire');if(failLock)throw Error('Lock unavailable');},releaseLock:()=>locks.push('release')})},
    CacheService:{getScriptCache:()=>({get:k=>inMemCache.get(k)||null,put:(k,v)=>inMemCache.set(k,String(v)),remove:k=>inMemCache.delete(k)})},
    Session:{getScriptTimeZone:()=> 'Asia/Singapore',getActiveUser:()=>({getEmail:()=>activeEmail}),getEffectiveUser:()=>({getEmail:()=>effectiveEmail})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key in scriptProperties ? scriptProperties[key] : (key==='APP_ENVIRONMENT'?appEnvironment:(key==='ROSTER_V2_ADMIN_EMAIL'?adminEmail:(key==='ROSTER_V2_SESSION_SECRET'?sessionSecret:(key==='ROSTER_ADMIN_PIN'?adminPin:null))))})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA-256'},Charset:{UTF_8:'UTF-8'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],computeHmacSha256Signature:(data,key)=>[...crypto.createHmac('sha256',key).update(data).digest()],base64EncodeWebSafe:input=>{const buf=Buffer.isBuffer(input)?input:(Array.isArray(input)?Buffer.from(input):Buffer.from(String(input)));return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');},base64DecodeWebSafe:str=>Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'),base64Decode:str=>[...Buffer.from(str,'base64')],newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')}),getUuid:()=>crypto.randomUUID(),formatDate:(date,tz,fmt)=>{const d=new NativeDate(date.getTime()+28800000);if(fmt==='yyyy-MM')return d.toISOString().slice(0,7);if(fmt==='yyyy-MM-dd')return d.toISOString().slice(0,10);return d.toISOString().slice(0,10);}},
  });
  vm.runInContext(source,context,{timeout:5000});
  return { context, grids,writes,locks,
    get:(action,parameters={})=>{ const out = context.doGet({parameter:{action,...parameters}}); return JSON.parse(out && typeof out.getContent === 'function' ? out.getContent() : out.text); },
    post:payload=>{ const out = context.doPost({postData:{contents:JSON.stringify(payload)}}); return JSON.parse(out && typeof out.getContent === 'function' ? out.getContent() : out.text); },
    jsonState:()=>JSON.parse(JSON.stringify(grids)),
    core:()=>vm.runInContext('RosterCompatibility',context),
  };
}
