const DASH = '-';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCell(value) {
  const names = String(value ?? '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!names.length) return DASH;
  return names.map(escapeHtml).join('<br>');
}

function renderContactRows(contacts = []) {
  if (!contacts.length) {
    return '<div class="contact-row muted">No contact details available.</div>';
  }

  return contacts.map((contact) => {
    const displayName = contact.name || DASH;
    const name = displayName === DASH || /^dr\.?\s/i.test(displayName)
      ? displayName
      : `Dr. ${displayName}`;
    const phone = String(contact.phone || DASH).toUpperCase();
    return `
      <div class="contact-row">
        <span>${escapeHtml(name.toUpperCase())}</span>
        <strong>${escapeHtml(phone)}</strong>
      </div>
    `;
  }).join('');
}

function renderTable({ rosterType, rows }) {
  const isEpOnly = rosterType === 'EP ROSTER';

  const header = isEpOnly
    ? `
      <tr>
        <th rowspan="2" class="date-col">DATE</th>
        <th rowspan="2" class="day-col">DAY</th>
        <th colspan="2">EMERGENCY PHYSICIAN</th>
      </tr>
      <tr>
        <th>AM<br><span>8AM-4PM</span></th>
        <th>ONCALL<br><span>4PM-8AM</span></th>
      </tr>
    `
    : `
      <tr>
        <th rowspan="2" class="date-col">DATE</th>
        <th rowspan="2" class="day-col">DAY</th>
        <th colspan="3">MEDICAL OFFICER</th>
        <th colspan="2">EMERGENCY PHYSICIAN</th>
      </tr>
      <tr>
        <th>AM</th>
        <th>PM</th>
        <th>NIGHT</th>
        <th>AM<br><span>8AM-4PM</span></th>
        <th>ONCALL<br><span>4PM-8AM</span></th>
      </tr>
    `;

  const body = rows.map((row) => {
    let rowClassAttr = '';
    if (row.isHoliday) {
      rowClassAttr = ' class="holiday"';
    } else if (row.day === 'SAT' || row.day === 'SUN') {
      rowClassAttr = ' class="weekend"';
    }

    if (isEpOnly) {
      return `
        <tr${rowClassAttr}>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.day)}</td>
          <td>${formatCell(row.epAm)}</td>
          <td>${formatCell(row.epOncall)}</td>
        </tr>
      `;
    }

    return `
      <tr${rowClassAttr}>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.day)}</td>
        <td>${formatCell(row.moAm)}</td>
        <td>${formatCell(row.moPm)}</td>
        <td>${formatCell(row.moNight)}</td>
        <td>${formatCell(row.epAm)}</td>
        <td>${formatCell(row.epOncall)}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="roster-table ${isEpOnly ? 'ep-only' : 'mo-ep'}">
      <thead>${header}</thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderContacts({ rosterType, contacts }) {
  if (rosterType === 'EP ROSTER') {
    return `
      <section class="contact-grid single">
        <div class="contact-box">
          <h2>Emergency Physician Contact</h2>
          ${renderContactRows(contacts.ep)}
        </div>
      </section>
    `;
  }

  return `
    <section class="contact-grid">
      <div class="contact-box">
        <h2>Medical Officer Contact</h2>
        ${renderContactRows(contacts.mo)}
      </div>
      <div class="contact-box">
        <h2>Emergency Physician Contact</h2>
        ${renderContactRows(contacts.ep)}
      </div>
    </section>
  `;
}

function getPdfShiftClass(val) {
  if (!val) return '';
  const token = String(val).trim().toLowerCase();
  if (token === 'am') return 'shift-cell-am';
  if (token === 'pm') return 'shift-cell-pm';
  if (token === 'night' || token === 'n' || token === 'on' || token === 'on1' || token === 'on2' || token.includes('night')) {
    return 'shift-cell-night';
  }
  if (token === 'off') return 'shift-cell-off';
  if (token.includes('course')) return 'shift-cell-course';
  return 'shift-cell-other';
}

function renderSpreadsheetTable(days, doctors) {
  const headerHtml = `
    <tr>
      <th class="spreadsheet-name-col">NAME</th>
      ${days.map(day => {
    const isWeekend = day.dayName === 'SAT' || day.dayName === 'SUN';
    const isHoliday = !!day.holidayName;
    let dayClass = 'spreadsheet-day-col';
    if (isHoliday) dayClass += ' holiday-header';
    else if (isWeekend) dayClass += ' weekend-header';

    return `
          <th class="${dayClass}" style="width: calc((100% - 35mm) / ${days.length});" title="${escapeHtml(day.holidayName || '')}">
            <div class="day-num">${day.dayNum}</div>
            <div class="day-name">${day.dayName}</div>
          </th>
        `;
  }).join('')}
    </tr>
  `;

  const bodyHtml = doctors.map(doc => {
    return `
      <tr>
        <td class="spreadsheet-name-cell">${escapeHtml(doc.name.toUpperCase())}</td>
        ${days.map(day => {
      const shift = doc.shifts[day.dateStr] || { value: '', isStandby: false, isExtended: false };
      const isWeekend = day.dayName === 'SAT' || day.dayName === 'SUN';
      const isHoliday = !!day.holidayName;
      let cellClass = 'spreadsheet-shift-cell';
      if (isHoliday) cellClass += ' holiday-cell';
      else if (isWeekend) cellClass += ' weekend-cell';

      const displayVal = shift.value || '';
      if (displayVal) {
        let badges = '';
        if (shift.isStandby) {
          badges += '<span class="pdf-badge standby-badge">S</span>';
        }
        if (shift.isExtended) {
          badges += '<span class="pdf-badge extended-badge">EX</span>';
        }

        const shiftStyleClass = getPdfShiftClass(displayVal);
        return `
              <td class="${cellClass} ${shiftStyleClass}">
                <div class="shift-wrapper">
                  <span class="shift-val">${escapeHtml(displayVal)}</span>
                  ${badges ? `<div class="badges-wrapper">${badges}</div>` : ''}
                </div>
              </td>
            `;
      } else {
        return `<td class="${cellClass} empty-cell">-</td>`;
      }
    }).join('')}
      </tr>
    `;
  }).join('');

  return `
    <table class="spreadsheet-table">
      <thead>${headerHtml}</thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

function renderPlanningFooter({ preparedBy, checkedBy, approvedBy, holidaysHtml }) {
  return `
    <footer class="planning-footer">
      <div class="pdf-legend-box">
        <div class="pdf-legend-title">SHIFT LEGEND</div>
        <div class="pdf-legend-grid">
          <div class="pdf-legend-item"><strong>AM:</strong> Morning shift</div>
          <div class="pdf-legend-item"><strong>PM:</strong> Evening shift</div>
          <div class="pdf-legend-item"><strong>ON:</strong> Night shift</div>
          <div class="pdf-legend-item"><strong>PN:</strong> Post Night</div>
          <div class="pdf-legend-item"><strong>OH:</strong> Office Hour</div>
          <div class="pdf-legend-item"><strong>OFF:</strong> Day Off</div>
          <div class="pdf-legend-item"><strong>GOFF:</strong> Replacement Day Off</div>
          <div class="pdf-legend-item"><strong>HKA:</strong> Public Holiday</div>
          <div class="pdf-legend-item"><strong>GHKA:</strong> Replacement Public Holiday</div>
          <div class="pdf-legend-item"><strong>AL:</strong> Annual Leave</div>
          <div class="pdf-legend-item"><strong>EL:</strong> Emergency Leave</div>
          <div class="pdf-legend-item"><strong>MC:</strong> Medical Leave</div>
          <div class="pdf-legend-item"><strong>Course:</strong> Course / Training etc</div>
          <div class="pdf-legend-item"><strong>Court:</strong> Court (Subpoena / Witness)</div>
        </div>
      </div>
      
      ${holidaysHtml || ''}
      
      <div class="pdf-signatures-container">
        <div class="pdf-signature-panel">
          <div class="pdf-sig-title">Prepared by,</div>
          <div class="pdf-sig-space"></div>
          <div class="pdf-sig-line"></div>
          <div class="pdf-sig-name">(${escapeHtml(preparedBy)})</div>
        </div>
        <div class="pdf-signature-panel">
          <div class="pdf-sig-title">Checked by,</div>
          <div class="pdf-sig-space"></div>
          <div class="pdf-sig-line"></div>
          <div class="pdf-sig-name">(${escapeHtml(checkedBy)})</div>
        </div>
        <div class="pdf-signature-panel">
          <div class="pdf-sig-title">Approved by,</div>
          <div class="pdf-sig-space"></div>
          <div class="pdf-sig-line"></div>
          <div class="pdf-sig-name">(${escapeHtml(approvedBy)})</div>
        </div>
      </div>
    </footer>
  `;
}

function buildPrintDocument({
  mainTitle,
  rosterType,
  monthYear,
  version,
  notes,
  logoUrl,
  rows,
  contacts,
  spreadsheetDays = [],
  spreadsheetDoctors = [],
  preparedBy = '',
  checkedBy = '',
  approvedBy = '',
}) {
  const dateLine = `${monthYear || ''} ${version || ''}`.trim();
  const isLandscape = rosterType === 'MO ROSTER' || rosterType === 'SPREADSHEET ROSTER';

  // Extract public holidays for the month if it's landscape (spreadsheet)
  let holidaysHtml = '';
  if (isLandscape && spreadsheetDays.length > 0) {
    const seen = new Set();
    const holidays = [];
    spreadsheetDays.forEach(day => {
      if (day.holidayName) {
        const parts = day.dateStr.split('-');
        const formattedDate = `${parseInt(parts[2])}/${parseInt(parts[1])}`; // DD/MM format
        const key = `${formattedDate}: ${day.holidayName}`;
        if (!seen.has(key)) {
          seen.add(key);
          holidays.push({ date: formattedDate, name: day.holidayName });
        }
      }
    });

    holidaysHtml = `
      <div class="pdf-holidays-box">
        <div class="pdf-holidays-title">PUBLIC HOLIDAYS</div>
        <div class="pdf-holidays-list">
          ${holidays.length > 0
        ? holidays.map(h => `
                <div class="pdf-holiday-item">
                  <strong>${escapeHtml(h.date)}:</strong> ${escapeHtml(h.name)}
                </div>
              `).join('')
        : '<div class="pdf-holiday-item empty">None</div>'
      }
        </div>
      </div>
    `;
  }

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(rosterType)} ${escapeHtml(dateLine)}</title>
        <style>
          @page { size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'}; margin: 0; }
          * { box-sizing: border-box; }
          html,
          body {
            margin: 0;
            width: 100%;
            min-height: 100%;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            background: #fff;
          }
          body {
            display: flex;
            justify-content: center;
            align-items: flex-start;
          }
          .page {
            width: 210mm;
            height: 297mm;
            padding: 6mm;
            overflow: hidden;
            background: #fff;
          }
          .page.landscape {
            width: 297mm;
            height: 210mm;
          }
          .scale-frame {
            width: 198mm;
            height: 285mm;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            overflow: hidden;
          }
          .scale-frame.landscape {
            width: 285mm;
            height: 198mm;
          }
          .scale-target {
            width: 145mm;
            transform-origin: top center;
          }
          .scale-target.landscape {
            width: 285mm;
          }
          .sheet {
            width: 145mm;
            min-height: 285mm;
            display: flex;
            flex-direction: column;
            gap: 2.4mm;
          }
          .sheet.landscape {
            width: 285mm;
            min-height: 198mm;
            gap: 2mm;
          }
          .header {
            display: flex;
            justify-content: center;
            min-height: 18mm;
          }
          .logo {
            width: 13mm;
            height: 13mm;
            object-fit: contain;
          }
          .headline {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
            text-align: center;
            line-height: 1.08;
          }
          .headline .main {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .08em;
          }
          .headline h1 {
            margin: 2px 0 1px;
            font-size: 15px;
            font-weight: 900;
            letter-spacing: .08em;
          }
          .headline .date-line {
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .08em;
          }
          .roster-table {
            width: 100%;
            margin-inline: auto;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 6.7px;
            line-height: 1.05;
          }
          .roster-table th,
          .roster-table td {
            border: 1px solid #111827;
            text-align: center;
            vertical-align: middle;
            padding: 1.2px 2px;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .roster-table th {
            background: #374151;
            color: #ffffff;
            font-size: 6.8px;
            font-weight: 900;
            letter-spacing: .04em;
          }
          .roster-table th span {
            font-size: 5.6px;
            letter-spacing: 0;
          }
          .roster-table td {
            height: 5.8mm;
            font-weight: 700;
          }
          .roster-table .date-col { width: 9mm; }
          .roster-table .day-col { width: 10mm; }
          .roster-table.mo-ep th:nth-child(n+3),
          .roster-table.mo-ep td:nth-child(n+3) { width: calc((100% - 19mm) / 5); }
          .roster-table.ep-only { width: 70mm; }
          .roster-table.ep-only th:nth-child(n+3),
          .roster-table.ep-only td:nth-child(n+3) { width: calc((100% - 19mm) / 2); }
          .roster-table tr.weekend td {
            background: #e5e7eb;
            color: #111827;
          }
          .roster-table tr.holiday td {
            background: #fee2e2 !important;
            color: #111827;
          }
          
          /* Spreadsheet Table Styles */
          .spreadsheet-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 5.5px;
            line-height: 1.1;
          }
          .spreadsheet-table th,
          .spreadsheet-table td {
            border: 1px solid #111827;
            text-align: center;
            vertical-align: middle;
            padding: 1px 0.5px;
            height: 4.8mm;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .spreadsheet-table th {
            background: #374151;
            color: #ffffff;
            font-weight: 800;
          }
          .spreadsheet-table th.weekend-header {
            background: #4b5563;
          }
          .spreadsheet-table th.holiday-header {
            background: #991b1b;
          }
          .spreadsheet-table td.weekend-cell {
            background: #f3f4f6;
          }
          .spreadsheet-table td.holiday-cell {
            background: #fee2e2;
          }
          .day-num {
            font-size: 6px;
            font-weight: 800;
          }
          .day-name {
            font-size: 4px;
            opacity: 0.85;
          }
          .spreadsheet-name-col {
            width: 35mm;
            min-width: 35mm;
            max-width: 35mm;
          }
          .spreadsheet-name-cell {
            width: 35mm;
            min-width: 35mm;
            max-width: 35mm;
            font-size: 5.5px;
            font-weight: bold;
            text-align: left !important;
            padding-left: 2px !important;
            background: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .shift-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            width: 100%;
            height: 100%;
          }
          .shift-val {
            font-size: 6.0px;
            font-weight: 800;
          }
          .badges-wrapper {
            display: flex;
            gap: 0.5px;
            position: absolute;
            bottom: 0.3px;
            right: 0.3px;
          }
          .pdf-badge {
            font-size: 4.5px;
            font-weight: 900;
            padding: 0.2px 0.8px;
            border-radius: 1px;
            line-height: 1;
          }
          .standby-badge {
            background: #f59e0b !important;
            color: #ffffff !important;
          }
          .extended-badge {
            background: #3b82f6 !important;
            color: #ffffff !important;
          }
          
          /* Shift Badge Colors for PDF Cell Backgrounds */
          .shift-cell-am {
            background: #f0fdf4 !important;
            color: #166534 !important;
          }
          .shift-cell-pm {
            background: #fffbeb !important;
            color: #92400e !important;
          }
          .shift-cell-night {
            background: #fef2f2 !important;
            color: #991b1b !important;
          }
          .shift-cell-off {
            background: #eff6ff !important;
            color: #1e40af !important;
          }
          .shift-cell-course {
            background: #fff7ed !important;
            color: #9a3412 !important;
          }
          .shift-cell-other {
            background: #f8fafc !important;
            color: #334155 !important;
          }
          
          /* Footer Flex Layout */
          .planning-footer {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 6mm;
            margin-top: 2.5mm;
            width: 100%;
          }
          
          /* Legend Box Styles */
          .pdf-legend-box {
            border: 1px solid #111827;
            border-radius: 4px;
            padding: 2mm 3mm;
            font-family: Arial, sans-serif;
            width: fit-content;
          }
          .pdf-legend-title {
            font-size: 6.5px;
            font-weight: 850;
            border-bottom: 1px solid #111827;
            padding-bottom: 1px;
            margin-bottom: 2px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            text-align: left;
          }
          .pdf-legend-grid {
            display: grid;
            grid-auto-flow: column;
            grid-template-rows: repeat(7, auto);
            justify-content: start;
            gap: 1px 6mm;
          }
          .pdf-legend-item {
            font-size: 5.5px;
            line-height: 1.2;
            text-align: left;
            white-space: nowrap;
          }
          .pdf-legend-item strong {
            font-weight: 900;
          }
          
          /* Holidays Box Styles */
          .pdf-holidays-box {
            border: 1px solid #111827;
            border-radius: 4px;
            padding: 2mm 3mm;
            font-family: Arial, sans-serif;
            width: fit-content;
            min-width: 40mm;
          }
          .pdf-holidays-title {
            font-size: 6.5px;
            font-weight: 850;
            border-bottom: 1px solid #111827;
            padding-bottom: 1px;
            margin-bottom: 2px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            text-align: left;
          }
          .pdf-holidays-list {
            display: flex;
            flex-direction: column;
            gap: 1.5px;
          }
          .pdf-holiday-item {
            font-size: 5.5px;
            line-height: 1.25;
            text-align: left;
            white-space: nowrap;
          }
          .pdf-holiday-item.empty {
            color: #6b7280;
            font-style: italic;
          }

          /* Signature Styles */
          .pdf-signatures-container {
            display: flex;
            gap: 3mm;
            flex: 0 0 50%;
            width: 50%;
            justify-content: space-between;
          }
          .pdf-signature-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            font-family: Arial, sans-serif;
          }
          .pdf-sig-title {
            font-size: 6.5px;
            font-weight: 800;
            align-self: flex-start;
            padding-left: 2mm;
          }
          .pdf-sig-space {
            height: 10mm;
          }
          .pdf-sig-line {
            width: 90%;
            border-bottom: 1px solid #111827;
            margin-bottom: 1.5mm;
          }
          .pdf-sig-name {
            font-size: 6.5px;
            font-weight: 800;
            text-transform: uppercase;
            min-height: 10px;
          }

          .notes {
            min-height: 4mm;
            margin-top: 1mm;
            font-size: 6.8px;
            font-weight: 700;
            white-space: pre-wrap;
          }
          .contact-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            width: 108mm;
            gap: 2mm;
            margin-left: auto;
            margin-right: auto;
            margin-top: 6mm;
          }
          .contact-grid.single {
            grid-template-columns: 1fr;
            width: 62mm;
          }
          .contact-box {
            border: 1px solid #111827;
            min-height: 7mm;
          }
          .contact-box h2 {
            margin: 0;
            padding: 1px 3px;
            border-bottom: 1px solid #111827;
            background: #374151;
            color: #ffffff;
            font-size: 6.2px;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: .05em;
          }
          .contact-row {
            display: flex;
            justify-content: flex-start;
            align-items: baseline;
            gap: 2mm;
            padding: 0.8px 3px;
            border-top: 1px solid #e5e7eb;
            font-size: 6.7px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .contact-row span {
            flex: 1 1 auto;
            min-width: 0;
          }
          .contact-row strong {
            flex: 0 0 auto;
            text-align: left;
            padding-left: 1.5mm;
          }
          .contact-row:first-of-type {
            border-top: 0;
          }
          .contact-row.muted {
            color: #6b7280;
            font-style: italic;
          }
          @media print {
            html,
            body {
              width: ${isLandscape ? '297mm' : '210mm'};
              height: ${isLandscape ? '210mm' : '297mm'};
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }
            .page {
              page-break-after: avoid;
              page-break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <main class="page ${isLandscape ? 'landscape' : ''}">
          <div class="scale-frame ${isLandscape ? 'landscape' : ''}">
            <div class="scale-target ${isLandscape ? 'landscape' : ''}" id="scaleTarget">
              <section class="sheet ${isLandscape ? 'landscape' : ''}" id="sheet">
                <header class="header">
                  <div class="headline">
                    <img class="logo" src="${escapeHtml(logoUrl)}" alt="">
                    <div class="main">${escapeHtml(mainTitle)}</div>
                    <h1>${escapeHtml(rosterType)}</h1>
                    <div class="date-line">${escapeHtml(dateLine)}</div>
                  </div>
                </header>
                ${isLandscape
      ? renderSpreadsheetTable(spreadsheetDays, spreadsheetDoctors)
      : renderTable({ rosterType, rows })
    }
                ${notes ? `<section class="notes">${escapeHtml(notes)}</section>` : ''}
                ${isLandscape
      ? renderPlanningFooter({ preparedBy, checkedBy, approvedBy, holidaysHtml })
      : renderContacts({ rosterType, contacts })
    }
              </section>
            </div>
          </div>
        </main>
        <script>
          function fitToOnePage() {
            const frame = document.querySelector('.scale-frame');
            const target = document.getElementById('scaleTarget');
            const sheet = document.getElementById('sheet');
            if (!frame || !target || !sheet) return;
            const widthScale = frame.clientWidth / sheet.scrollWidth;
            const heightScale = frame.clientHeight / sheet.scrollHeight;
            const scale = Math.min(widthScale, heightScale, 1);
            target.style.transform = 'scale(' + scale + ')';
          }

          window.addEventListener('load', () => {
            window.focus();
            requestAnimationFrame(() => {
              fitToOnePage();
              setTimeout(() => window.print(), 200);
            });
          });

          window.addEventListener('beforeprint', fitToOnePage);
        </script>
      </body>
    </html>`;
}

export function openRosterPdfExport(options) {
  const printWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!printWindow) {
    throw new Error('Popup blocked. Allow popups for this site and try exporting again.');
  }

  printWindow.document.open();
  printWindow.document.write(buildPrintDocument(options));
  printWindow.document.close();
}
