import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';

/**
 * Format a date string (YYYY-MM-DD or ISO) into dd/mm/yyyy
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Clean the applicant name for the filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_{2 reflex}/g, '_');
}

/**
 * Generate and download the GHKA Memo DOCX.
 * @param {Object} payload The export payload.
 */
export async function generateGhkaMemoDocx(payload) {
  try {
    // 1. Fetch the template DOCX
    const templateUrl = `${import.meta.env.BASE_URL}templates/ghka-memo-template.docx`;
    const response = await fetch(templateUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to load template from ${templateUrl}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // 2. Load the binary data into PizZip
    const zip = new PizZip(arrayBuffer);

    // 3. Initialize docxtemplater
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // 4. Map the payload to the specific DOCX variables
    // The template has placeholders: {NAME}, {DATE}, {ID}, {PHONE}, {EMAIL}
    // And dynamic table rows using {#rows} ... {/rows} loop.
    
    const data = {
      NAME: (payload.applicantName || '').toUpperCase(),
      DATE: formatDate(payload.memoDate),
      ID: payload.applicantStaffId || '',
      PHONE: payload.applicantPhone || '',
      EMAIL: payload.applicantEmail || '',
      
      // Dynamic rows mapping
      rows: (payload.rows || []).map((r, index) => ({
        no: `${index + 1}.`,
        phDate: formatDate(r.phDate),
        phName: r.phName || '',
        ghkaDate: formatDate(r.ghkaDate),
        ghkaDay: r.ghkaDay || ''
      }))
    };

    // 5. Perform the placeholder replacement
    doc.render(data);

    // 6. Generate the binary output
    const blob = doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    // 7. Trigger the download
    const cleanName = sanitizeFilename(payload.applicantName || 'Applicant');
    const filename = `GHKA Memo - ${cleanName} - ${payload.memoMonth}.docx`;
    saveAs(blob, filename);

  } catch (error) {
    console.error('Error generating GHKA Memo DOCX:', error);
    throw error;
  }
}
