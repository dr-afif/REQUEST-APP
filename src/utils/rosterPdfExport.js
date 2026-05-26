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
    const weekendClass = row.day === 'SAT' || row.day === 'SUN' ? ' class="weekend"' : '';
    if (isEpOnly) {
      return `
        <tr${weekendClass}>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.day)}</td>
          <td>${formatCell(row.epAm)}</td>
          <td>${formatCell(row.epOncall)}</td>
        </tr>
      `;
    }

    return `
      <tr${weekendClass}>
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

function buildPrintDocument({ mainTitle, rosterType, monthYear, version, notes, logoUrl, rows, contacts }) {
  const dateLine = `${monthYear || ''} ${version || ''}`.trim();

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(rosterType)} ${escapeHtml(dateLine)}</title>
        <style>
          @page { size: A4 portrait; margin: 0; }
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
          .scale-frame {
            width: 198mm;
            height: 285mm;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            overflow: hidden;
          }
          .scale-target {
            width: 145mm;
            transform-origin: top center;
          }
          .sheet {
            width: 145mm;
            min-height: 285mm;
            display: flex;
            flex-direction: column;
            gap: 2.4mm;
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
          .roster-table.ep-only th:nth-child(n+3),
          .roster-table.ep-only td:nth-child(n+3) { width: calc((100% - 19mm) / 2); }
          .roster-table tr.weekend td {
            background: #e5e7eb;
            color: #111827;
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
            margin-top: auto;
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
              width: 210mm;
              height: 297mm;
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
        <main class="page">
          <div class="scale-frame">
            <div class="scale-target" id="scaleTarget">
              <section class="sheet" id="sheet">
                <header class="header">
                  <div class="headline">
                    <img class="logo" src="${escapeHtml(logoUrl)}" alt="">
                    <div class="main">${escapeHtml(mainTitle)}</div>
                    <h1>${escapeHtml(rosterType)}</h1>
                    <div class="date-line">${escapeHtml(dateLine)}</div>
                  </div>
                </header>
                ${renderTable({ rosterType, rows })}
                ${notes ? `<section class="notes">${escapeHtml(notes)}</section>` : ''}
                ${renderContacts({ rosterType, contacts })}
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
