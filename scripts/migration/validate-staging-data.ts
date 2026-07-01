import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { 
    StagingUser, StagingShiftType, StagingLimitGroup, 
    StagingShiftBlock, StagingRosterEntry, StagingRequest, StagingSetting 
} from './types';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse args
const args = process.argv.slice(2);
let batchId = '';
let departmentName = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch') batchId = args[i + 1];
    if (args[i] === '--department') departmentName = args[i + 1];
}

if (!batchId || !departmentName) {
    console.error("Usage: ts-node validate-staging-data.ts --batch <uuid> --department <name>");
    process.exit(1);
}

async function validate() {
    console.log(`Starting validation for batch ${batchId} and department '${departmentName}'...`);
    const errors: any[] = [];
    const summary: any = {
        batchId,
        departmentName,
        totalUsers: 0,
        totalShiftTypes: 0,
        totalRosterEntries: 0,
        totalRequests: 0,
        pass: true
    };

    // 1. Fetch Staging Data
    const { data: users } = await supabase.from('google_sheets_users_import_staging').select('*').eq('import_batch_id', batchId) as { data: StagingUser[] | null };
    const { data: shiftTypes } = await supabase.from('google_sheets_shift_types_import_staging').select('*').eq('import_batch_id', batchId) as { data: StagingShiftType[] | null };
    const { data: rosters } = await supabase.from('google_sheets_roster_import_staging').select('*').eq('import_batch_id', batchId) as { data: StagingRosterEntry[] | null };
    const { data: requests } = await supabase.from('google_sheets_requests_import_staging').select('*').eq('import_batch_id', batchId) as { data: StagingRequest[] | null };

    const usersList = users || [];
    const shiftsList = shiftTypes || [];
    const rosterList = rosters || [];
    const requestList = requests || [];

    summary.totalUsers = usersList.length;
    summary.totalShiftTypes = shiftsList.length;
    summary.totalRosterEntries = rosterList.length;
    summary.totalRequests = requestList.length;

    const knownEmails = new Set<string>();
    const knownMemberNames = new Set<string>();
    const knownShiftNames = new Set<string>();

    // 2. Validate Users
    usersList.forEach(u => {
        if (!u.email) {
            errors.push({ table: 'users', row: u.raw_id, error: 'Missing email', name: u.member_name });
        } else {
            if (knownEmails.has(u.email.toLowerCase())) {
                errors.push({ table: 'users', row: u.raw_id, error: 'Duplicate email', email: u.email });
            }
            knownEmails.add(u.email.toLowerCase());
        }

        if (!u.member_name) {
            errors.push({ table: 'users', row: u.raw_id, error: 'Missing member_name' });
        } else {
            if (knownMemberNames.has(u.member_name)) {
                errors.push({ table: 'users', row: u.raw_id, error: 'Duplicate member_name', name: u.member_name });
            }
            knownMemberNames.add(u.member_name);
        }

        if (u.active && !['true', 'false', '1', '0', 'yes', 'no'].includes(u.active.toLowerCase())) {
            errors.push({ table: 'users', row: u.raw_id, error: 'Invalid boolean for active', val: u.active });
        }
    });

    // 3. Validate Shift Types
    shiftsList.forEach(s => {
        if (s.name) {
            knownShiftNames.add(s.name);
        }
    });

    // Helper for date
    const isValidDate = (d: string) => !isNaN(Date.parse(d)) && /^\d{4}-\d{2}-\d{2}$/.test(d);

    // 4. Validate Roster
    rosterList.forEach(r => {
        if (r.member_name && !knownMemberNames.has(r.member_name)) {
            errors.push({ table: 'roster', row: r.raw_id, error: 'Unknown member_name', name: r.member_name });
        }
        if (r.date && !isValidDate(r.date)) {
            errors.push({ table: 'roster', row: r.raw_id, error: 'Invalid date format (must be YYYY-MM-DD)', date: r.date });
        }
        if (r.shifts) {
            const splitShifts = r.shifts.split(',').map(s => s.trim());
            splitShifts.forEach(shift => {
                if (!knownShiftNames.has(shift)) {
                    errors.push({ table: 'roster', row: r.raw_id, error: 'Unknown shift code', shift: shift });
                }
            });
        }
    });

    // 5. Validate Requests
    const validRequestStatuses = ['active', 'old', 'cancelled'];
    const validApprovalStatuses = ['pending_partner', 'pending_admin', 'approved', 'rejected'];

    requestList.forEach(req => {
        if (req.member_name && !knownMemberNames.has(req.member_name)) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Unknown member_name', name: req.member_name });
        }
        if (req.swap_partner && !knownMemberNames.has(req.swap_partner)) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Unknown swap_partner', name: req.swap_partner });
        }
        if (req.date && !isValidDate(req.date)) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Invalid date format', date: req.date });
        }
        if (req.request_shift && !knownShiftNames.has(req.request_shift)) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Unknown shift code', shift: req.request_shift });
        }
        if (req.status && !validRequestStatuses.includes(req.status.toLowerCase().replace(' ', '_'))) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Invalid status', val: req.status });
        }
        if (req.approval_status && !validApprovalStatuses.includes(req.approval_status.toLowerCase().replace(' ', '_'))) {
            errors.push({ table: 'requests', row: req.raw_id, error: 'Invalid approval_status', val: req.approval_status });
        }
    });

    // Write outputs
    summary.pass = errors.length === 0;
    summary.errorCount = errors.length;

    fs.writeFileSync('migration-errors.json', JSON.stringify(errors, null, 2));
    fs.writeFileSync('migration-summary.json', JSON.stringify(summary, null, 2));

    console.log(`\nValidation complete.`);
    console.log(`Summary: ${JSON.stringify(summary, null, 2)}`);
    
    if (errors.length > 0) {
        console.error(`\n[FAIL] Validation failed with ${errors.length} errors. See migration-errors.json for details.`);
        process.exit(1);
    } else {
        console.log(`\n[PASS] Validation successful! Safe to run import.`);
    }
}

validate().catch(e => {
    console.error(e);
    process.exit(1);
});
