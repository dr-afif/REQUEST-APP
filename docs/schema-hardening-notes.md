# Schema Hardening Notes

This document explains the advanced PostgreSQL features used to secure the database schema against privilege escalation, unauthorized access, and data corruption.

## 1. Privilege Escalation Prevention via RPCs

In a typical Supabase setup, developers often grant `UPDATE` permissions on the `user_profiles` or `requests` tables using Row Level Security (RLS) like so:
`CREATE POLICY "Update own" ON profiles FOR UPDATE USING (id = auth.uid());`

**The Vulnerability**: While this ensures a user can only update their *own* row, it allows them to update **any column** on that row. A malicious staff member could send a raw API request:
`supabase.from('user_profiles').update({ role: 'super_admin' }).eq('id', myId)`

**The Fix**: In our hardened schema, standard `UPDATE` and `INSERT` permissions have been revoked for staff on critical tables (`user_profiles`, `requests`). Instead, modifications must route through **Stored Procedures (RPCs)** configured as `SECURITY DEFINER`.

By using `update_own_profile(p_phone)`, the database strictly guarantees that *only* the phone number can be changed. The role, department, and active status are mathematically protected from client-side tampering.

### Execution Privileges & Search Paths
By default, Postgres grants `EXECUTE` privileges on new functions to `PUBLIC`. We have explicitly run `REVOKE EXECUTE ON FUNCTION <name> FROM PUBLIC` for all our custom functions, and only granted access to `authenticated` users where absolutely necessary. 
Furthermore, all `SECURITY DEFINER` functions explicitly declare `SET search_path = public` to prevent malicious schema-shadowing attacks.

### Admin Privilege Escalation Protection
While regular staff are blocked by RPCs, department `admins` have broad RLS rules (`FOR ALL`). To prevent an admin from running a rogue `UPDATE user_profiles SET role = 'super_admin'`, we deployed a `BEFORE UPDATE` trigger (`prevent_role_escalation`). This trigger intercepts every profile update and physically blocks the transaction if the `role` is being modified by anyone other than an actual `super_admin`.

## 2. Department Isolation via Composite Foreign Keys

In multi-tenant (or multi-department) applications, a common vulnerability is "Cross-Tenant Data Leakage."
For example, if `shift_type_id` is just a UUID, a malicious user in Department A could theoretically submit a request for a `shift_type_id` that belongs to Department B.

**The Fix**: We implemented **Composite Foreign Keys**.
Instead of `FOREIGN KEY (shift_type_id) REFERENCES shift_types(id)`, we use:
`FOREIGN KEY (shift_type_id, department_id) REFERENCES shift_types(id, department_id)`

This forces the database engine to verify that the shift type being requested actually belongs to the same department as the user making the request. It is impossible to bypass this check at the database level.

### Handling ON DELETE Constraints
When using Composite Foreign Keys, Postgres has a strict rule regarding `ON DELETE SET NULL`. If the foreign key tries to nullify `department_id`, but `department_id` is declared as `NOT NULL` on the table, any deletion of the parent record will immediately crash the database with a constraint violation.
To fix this, we strictly use `ON DELETE RESTRICT` on composite keys (e.g. `shift_types.limit_group_id` and `requests.swap_partner_id`). You cannot delete a limit group if it is actively tied to a shift type; you must reassign the shift type first.

## 3. Secure Audit Logging

Audit logs are critical for medical/roster systems. If logs are written directly from the frontend using `supabase.from('audit_logs').insert(...)`, a malicious user could spoof log entries (e.g., claiming an admin approved their request).

**The Fix**: Public `INSERT` access to `audit_logs` is disabled. Logs are strictly written via the `log_audit_event()` RPC, which automatically injects `auth.uid()` securely on the server side. Additionally, execution privileges for `log_audit_event` are explicitly **not** granted to `authenticated` users—it is an internal-only function called by the other trusted RPCs.

## 4. Staging Tables for Safe Migrations

Raw data from Google Sheets (CSVs) is notoriously messy (dates in different formats, numbers parsed as strings, trailing spaces). Importing this directly into a hardened, strictly-typed production table (where enums, UUIDs, and Dates are strictly enforced) will result in catastrophic failure.

**The Fix**: We created a dedicated set of `_staging` tables where every single column is of type `TEXT`. This allows a raw CSV dump to import with a 100% success rate. Once the data is resting safely in Postgres as text, we can use safe PL/pgSQL scripts to cast, clean, and insert the data into the production tables without downtime.
