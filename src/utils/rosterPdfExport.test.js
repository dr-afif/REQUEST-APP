import assert from 'node:assert/strict';
import { buildPrintDocument } from './rosterPdfExport.js';

const sampleRows = [
  {
    date: 1,
    day: 'THU',
    moAm: 'Ali, Abu',
    moPm: 'Bala',
    moNight: 'Chong',
    epAm: 'Dr. Echo',
    epPassive: 'Dr. Foxtrot',
    epOncall: 'Dr. Golf',
    holidayName: '',
    isHoliday: false,
  },
];

const sampleContacts = {
  mo: [{ name: 'Ali', phone: '012-1111111' }],
  ep: [{ name: 'Echo', phone: '012-2222222' }],
};

function runTests() {
  const epOnlyHtml = buildPrintDocument({
    mainTitle: 'HOSPITAL TEST',
    rosterType: 'EP ROSTER',
    monthYear: 'NOVEMBER 2026',
    version: 'V1',
    notes: '',
    logoUrl: '/logo.png',
    rows: sampleRows,
    contacts: sampleContacts,
  });
  assert.ok(epOnlyHtml.includes('class="roster-table ep-only"'), 'EP ROSTER uses ep-only table class');
  assert.ok(epOnlyHtml.includes('<th colspan="2">EMERGENCY PHYSICIAN</th>'), 'EP ROSTER keeps 2 EP columns');
  assert.ok(epOnlyHtml.includes('Dr. Echo'), 'EP ROSTER renders epAm');
  assert.ok(epOnlyHtml.includes('Dr. Golf'), 'EP ROSTER renders epOncall');
  assert.ok(!epOnlyHtml.includes('Dr. Foxtrot'), 'EP ROSTER omits epPassive');
  assert.ok(!epOnlyHtml.includes('(PASSIVE)'), 'EP ROSTER omits Office Hour Passive header');
  assert.ok(epOnlyHtml.includes('Emergency Physician Contact'), 'EP ROSTER includes EP contacts');
  assert.ok(!epOnlyHtml.includes('Medical Officer Contact'), 'EP ROSTER excludes MO contacts');

  const epPlusHtml = buildPrintDocument({
    mainTitle: 'HOSPITAL TEST',
    rosterType: 'EP+ ROSTER',
    monthYear: 'NOVEMBER 2026',
    version: 'V1',
    notes: '',
    logoUrl: '/logo.png',
    rows: sampleRows,
    contacts: sampleContacts,
  });
  assert.ok(epPlusHtml.includes('class="roster-table ep-plus"'), 'EP+ ROSTER uses ep-plus table class');
  assert.ok(epPlusHtml.includes('<th colspan="3">EMERGENCY PHYSICIAN</th>'), 'EP+ ROSTER spans 3 EP columns');
  assert.ok(epPlusHtml.includes('OFFICE HOUR<br><span>(PASSIVE)</span>'), 'EP+ ROSTER includes Office Hour (Passive) header');
  assert.ok(epPlusHtml.includes('Dr. Echo'), 'EP+ ROSTER renders epAm');
  assert.ok(epPlusHtml.includes('Dr. Foxtrot'), 'EP+ ROSTER renders epPassive');
  assert.ok(epPlusHtml.includes('Dr. Golf'), 'EP+ ROSTER renders epOncall');
  assert.ok(epPlusHtml.includes('Emergency Physician Contact'), 'EP+ ROSTER includes EP contacts');
  assert.ok(!epPlusHtml.includes('Medical Officer Contact'), 'EP+ ROSTER excludes MO contacts');

  const moEpHtml = buildPrintDocument({
    mainTitle: 'HOSPITAL TEST',
    rosterType: 'MO & EP ROSTER',
    monthYear: 'NOVEMBER 2026',
    version: 'V1',
    notes: '',
    logoUrl: '/logo.png',
    rows: sampleRows,
    contacts: sampleContacts,
  });
  assert.ok(moEpHtml.includes('class="roster-table mo-ep"'), 'MO & EP ROSTER uses mo-ep table class');
  assert.ok(moEpHtml.includes('<th colspan="3">MEDICAL OFFICER</th>'), 'MO & EP ROSTER has 3 MO columns');
  assert.ok(moEpHtml.includes('<th colspan="2">EMERGENCY PHYSICIAN</th>'), 'MO & EP ROSTER keeps 2 EP columns');
  assert.ok(!moEpHtml.includes('Dr. Foxtrot'), 'MO & EP ROSTER omits epPassive');
  assert.ok(moEpHtml.includes('Medical Officer Contact'), 'MO & EP ROSTER includes MO contacts');
  assert.ok(moEpHtml.includes('Emergency Physician Contact'), 'MO & EP ROSTER includes EP contacts');

  console.log('roster pdf export tests passed');
}

runTests();
