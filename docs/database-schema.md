# Database Schema Documentation

This document describes the Supabase Postgres schema for the roster and data-entry application. The schema is highly normalized and designed for multi-department isolation with robust Row Level Security (RLS).

## Core Concepts

*   **Multi-tenant (Department Level)**: Every table except `user_profiles` strictly enforces a `department_id` to ensure isolation. Users can only see data belonging to their assigned department.
*   **Role Based Access Control (RBAC)**: Enforced natively via Supabase RLS policies.
    *   `super_admin`: Full access across all departments.
    *   `admin`: Full access to configuration and roster data within their `department_id`.
    *   `staff`: Read-only access to roster and config. Staff cannot UPDATE or INSERT requests or profiles directly. They must use secure RPC functions to act on their data.
*   **Strict Typing**: Uses native PostgreSQL enums (`user_role`, `member_type`, `request_status`, `request_approval_status`, `request_type`) for data integrity.
*   **Composite Foreign Keys**: Tables use `(id, department_id)` as a composite foreign key requirement. This structurally guarantees that a `roster_entry` cannot point to a `user_profile` in Department A and a `shift_type` in Department B.

## Tables Overview

### 1. `departments`
*   **Purpose**: Top-level entity representing a working group or department.
*   **Columns**: `id`, `name`, `created_at`, `updated_at`.
*   **RLS**: Viewable by all. Managed by `super_admin`.

### 2. `user_profiles`
*   **Purpose**: Extends Supabase Auth (`auth.users`) to store application-specific user metadata.
*   **Columns**: 
    *   `id` (UUID) - References `auth.users(id)`.
    *   `department_id` - Links user to a specific department.
    *   `role` - `super_admin`, `admin`, or `staff`.
    *   `member_type` - `MO` (Medical Officer) or `EP` (Emergency Physician).
    *   `full_name`, `email`, `phone`, `staff_id`, `is_active`.
    *   `legacy_member_name` - Stores the old Google Sheets name string for migration identity matching.
*   **RLS**: Viewable by all authenticated users in the same department (or super_admin). Users CANNOT directly `UPDATE` their own profile; they must use the `update_own_profile` RPC. Admins can manage profiles in their department.

### 3. `limit_groups`
*   **Purpose**: Groups shift types together for quota limiting (e.g., "Leaves & Offs").
*   **Columns**: `id`, `department_id`, `name`, `default_limit`.

### 4. `shift_types`
*   **Purpose**: Defines available shifts (e.g., "AM", "PM", "AL").
*   **Columns**: 
    *   `id`, `department_id`, `name`, `is_public`.
    *   `limit_group_id` - Optional grouping for quota tracking.
    *   `display_order` - Controls UI rendering order.

### 5. `shift_blocks`
*   **Purpose**: Sets hard caps (quotas) on specific dates for specific shift types.
*   **Columns**: `id`, `department_id`, `date`, `shift_type_id`, `max_slots`.

### 6. `roster_entries`
*   **Purpose**: The actual daily schedule. Highly normalized: one row per person, per day, per shift.
*   **Columns**: 
    *   `id`, `department_id`.
    *   `user_id` (Who is working).
    *   `date` (When they are working).
    *   `shift_type_id` (What they are working).
*   **Constraints**: Unique constraint on `(user_id, date, shift_type_id)` prevents accidental duplicates. Foreign keys are composite `(user_id, department_id)` and `(shift_type_id, department_id)` to prevent cross-department data leakage.

### 7. `roster_snapshots`
*   **Purpose**: Freezes a month's roster data as JSON for publishing. Ensures historical accuracy even if underlying requests/data change later.
*   **Columns**: `id`, `department_id`, `month_key` (e.g., "2026-06"), `published_by`, `snapshot_data` (JSONB).

### 8. `requests`
*   **Purpose**: Tracks leave, off, and shift-swap requests.
*   **Columns**:
    *   `id`, `department_id`, `user_id`, `date`, `shift_type_id`.
    *   `status` - `active`, `old`, `cancelled`.
    *   `approval_status` - `pending_partner`, `pending_admin`, `approved`, `rejected`.
    *   `req_type` - `Leave`, `Swap`.
    *   `swap_partner_id` - Optional reference to another user for swaps.
*   **RLS**: `INSERT` and `UPDATE` are completely blocked for staff. Staff must use `create_request` and `cancel_own_request` RPCs. Admins manage department requests via `admin_approve_request` and `admin_reject_request` RPCs.

### 9. `settings`
*   **Purpose**: Key-value store for app configuration (e.g., UI preferences, toggle states).
*   **Columns**: `key`, `department_id`, `value` (JSONB).
*   **Constraints**: Primary Key is `(key, department_id)`.

### 10. `audit_logs`
*   **Purpose**: Tracks important system actions (e.g., "Admin approved swap").
*   **Columns**: `id`, `department_id`, `user_id`, `action`, `target`, `details` (JSONB).
*   **Security**: RLS explicitly blocks ALL public `INSERT` operations. Logs can only be written by the `log_audit_event()` RPC triggered securely from the server backend.

## Secure RPC Functions (SECURITY DEFINER)
To prevent privilege escalation, users interact with data mutations using these strict Stored Procedures:
*   `update_own_profile(p_phone TEXT, p_full_name TEXT)` - Allows updating safe profile fields while strictly protecting roles and department links.
*   `create_request(...)` - Safely creates a request and forces `status = active`, preventing a user from forcing an auto-approved request.
*   `cancel_own_request(p_request_id)` - Ensures you can only cancel your own active requests.
*   `admin_approve_request(p_request_id)` - Ensures only verified Admins can approve.
*   `admin_reject_request(p_request_id)` - Ensures only verified Admins can reject.
*   `log_audit_event(...)` - Securely logs events without allowing client spoofing.

## Security Definer Read Functions
To avoid circular RLS policy dependencies (where a table needs to query itself to verify permissions), two safe `SECURITY DEFINER` functions are included:
*   `public.get_user_role()`
*   `public.get_user_department()`
These allow any RLS policy to safely check the current user's role and department without causing infinite recursion.
