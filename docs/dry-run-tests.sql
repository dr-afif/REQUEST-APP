-- ==============================================================================
-- Supabase Dry-Run Testing Script (Micro-Hardened, Exception Safe)
-- ==============================================================================
-- This script contains SQL commands to verify the correctness of the Row Level
-- Security (RLS) policies, RPC functions, and composite foreign key constraints.
-- 
-- PRE-REQUISITE: You must have Supabase CLI installed.
-- 1. Run `supabase start`
-- 2. Run `supabase db reset`
-- 3. Connect to your local db or run these commands in Supabase Studio SQL Editor.

-- Setup Test Data (Run as postgres/super_admin)
BEGIN;
  -- Create Departments
  INSERT INTO public.departments (id, name) VALUES 
    ('11111111-1111-1111-1111-111111111111', 'Emergency Dept'),
    ('22222222-2222-2222-2222-222222222222', 'Surgery Dept')
  ON CONFLICT DO NOTHING;

  -- Create Auth Users (Required before inserting into user_profiles)
  INSERT INTO auth.users (id, email) VALUES
    ('33333333-3333-3333-3333-333333333333', 'staff@ed.com'),
    ('44444444-4444-4444-4444-444444444444', 'admin@ed.com'),
    ('55555555-5555-5555-5555-555555555555', 'admin@surg.com'),
    ('66666666-6666-6666-6666-666666666666', 'super@hospital.com'),
    ('99999999-9999-9999-9999-999999999999', 'no_profile@hospital.com')
  ON CONFLICT DO NOTHING;

  -- Create Profiles
  INSERT INTO public.user_profiles (id, department_id, role, email) VALUES 
    ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'staff', 'staff@ed.com'),
    ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'admin', 'admin@ed.com'),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'admin', 'admin@surg.com'),
    ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'super_admin', 'super@hospital.com')
  ON CONFLICT DO NOTHING;

  -- Create Shift Types
  INSERT INTO public.shift_types (id, department_id, name) VALUES 
    ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'ED_AM'),
    ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'SURG_AM')
  ON CONFLICT DO NOTHING;

COMMIT;

-- Use DO blocks to catch exceptions so the script doesn't abort.

-- ==============================================================================
-- TEST 1: Privilege Escalation Prevention (Staff cannot update role)
-- ==============================================================================
DO $$ 
BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; -- ED Admin

    UPDATE public.user_profiles SET role = 'super_admin' WHERE id = '33333333-3333-3333-3333-333333333333';
    
    RAISE NOTICE '[FAIL] Test 1: Admin successfully escalated privileges! This should not happen.';
EXCEPTION WHEN others THEN
    RAISE NOTICE '[PASS] Test 1: Privilege Escalation Prevention caught successfully (%).', SQLERRM;
END $$;

-- ==============================================================================
-- TEST 2: Cross-Department Constraints
-- ==============================================================================
DO $$ 
BEGIN
    INSERT INTO public.requests (department_id, user_id, date, shift_type_id)
    VALUES (
        '11111111-1111-1111-1111-111111111111', -- ED Dept
        '33333333-3333-3333-3333-333333333333', -- ED Staff
        '2026-01-01',
        '88888888-8888-8888-8888-888888888888'  -- Surg shift type
    );
    RAISE NOTICE '[FAIL] Test 2: Inserted cross-department data successfully! This should not happen.';
EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '[PASS] Test 2: Cross-department constraints blocked insert successfully (%).', SQLERRM;
WHEN others THEN
    RAISE NOTICE '[FAIL] Test 2: Failed with unexpected error: %', SQLERRM;
END $$;

-- ==============================================================================
-- TEST 3: RPC Logic (Staff actions)
-- ==============================================================================
DO $$ 
DECLARE
    v_req_id UUID;
BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- staff

    -- 3A: Direct insert should FAIL due to RLS
    BEGIN
        INSERT INTO public.requests (department_id, user_id, date, shift_type_id) VALUES ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '2026-01-01', '77777777-7777-7777-7777-777777777777');
        RAISE NOTICE '[FAIL] Test 3A: Staff bypassed RLS to insert request directly!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 3A: Direct request insertion blocked by RLS.';
    END;

    -- 3B: RPC insert should SUCCEED
    BEGIN
        SELECT public.create_request('2026-01-01'::DATE, '77777777-7777-7777-7777-777777777777'::UUID, 'Leave'::request_type) INTO v_req_id;
        RAISE NOTICE '[PASS] Test 3B: Request created via RPC successfully.';
    EXCEPTION WHEN others THEN
        RAISE NOTICE '[FAIL] Test 3B: RPC create_request failed: %', SQLERRM;
    END;

    -- 3C: Attempt to approve own request should FAIL
    BEGIN
        PERFORM public.admin_approve_request(v_req_id);
        RAISE NOTICE '[FAIL] Test 3C: Staff successfully approved their own request!';
    EXCEPTION WHEN others THEN
        RAISE NOTICE '[PASS] Test 3C: Staff blocked from approving requests (%).', SQLERRM;
    END;
END $$;

-- ==============================================================================
-- TEST 4: Admin Cross-Department Approval
-- ==============================================================================
DO $$ 
DECLARE
    v_req_id UUID;
BEGIN
    -- Need to find the request we created in test 3. Since DO blocks commit per block or rollback,
    -- we might need to recreate it if the block rolled back. But Test 3B succeeded, so we can't share variables.
    -- Let's just create one here as staff.
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
    SELECT public.create_request('2026-01-02'::DATE, '77777777-7777-7777-7777-777777777777'::UUID, 'Leave'::request_type) INTO v_req_id;

    -- Switch to Surg Admin
    SET LOCAL request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555'; 

    -- Try to approve the ED request
    PERFORM public.admin_approve_request(v_req_id);
    RAISE NOTICE '[FAIL] Test 4: Surg Admin approved ED request!';
EXCEPTION WHEN others THEN
    RAISE NOTICE '[PASS] Test 4: Admin cross-department approval blocked (%).', SQLERRM;
END $$;

-- ==============================================================================
-- TEST 5: Super Admin Cross-Department Approval
-- ==============================================================================
DO $$ 
DECLARE
    v_req_id UUID;
BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- staff
    SELECT public.create_request('2026-01-03'::DATE, '77777777-7777-7777-7777-777777777777'::UUID, 'Leave'::request_type) INTO v_req_id;

    SET LOCAL request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; -- super admin

    PERFORM public.admin_approve_request(v_req_id);
    RAISE NOTICE '[PASS] Test 5: Super Admin successfully approved cross-department request.';
EXCEPTION WHEN others THEN
    RAISE NOTICE '[FAIL] Test 5: Super Admin cross-department approval failed: %', SQLERRM;
END $$;

-- ==============================================================================
-- TEST 6: No-Profile User Attempting Admin Actions
-- ==============================================================================
DO $$ 
BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999'; -- no profile

    PERFORM public.admin_approve_request('00000000-0000-0000-0000-000000000000'::UUID);
    RAISE NOTICE '[FAIL] Test 6: No-profile user bypassed role checks!';
EXCEPTION WHEN others THEN
    RAISE NOTICE '[PASS] Test 6: No-profile user blocked correctly (%).', SQLERRM;
END $$;

-- ==============================================================================
-- TEST 7: Audit Logs & Internal RPC Protection
-- ==============================================================================
DO $$ 
BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- staff

    -- 7A: Direct Insert
    BEGIN
        INSERT INTO public.audit_logs (department_id, action) VALUES ('11111111-1111-1111-1111-111111111111', 'SPOOFED_ACTION');
        RAISE NOTICE '[FAIL] Test 7A: Direct audit log insert succeeded!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 7A: Direct audit log insert blocked by RLS.';
    END;

    -- 7B: Direct RPC Call
    BEGIN
        PERFORM public.log_audit_event('11111111-1111-1111-1111-111111111111'::UUID, 'SPOOF', 'SPOOF');
        RAISE NOTICE '[FAIL] Test 7B: Staff successfully executed log_audit_event!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 7B: log_audit_event execution blocked by privileges.';
    END;
END $$;

-- ==============================================================================
-- TEST 8: Explicit Function Privilege Checks
-- ==============================================================================
DO $$ 
DECLARE
    v_anon_can_execute BOOLEAN;
    v_auth_can_execute BOOLEAN;
    v_auth_can_audit BOOLEAN;
    v_anon_can_audit BOOLEAN;
BEGIN
    SELECT has_function_privilege('anon', 'public.update_own_profile(text, text)', 'execute') INTO v_anon_can_execute;
    SELECT has_function_privilege('authenticated', 'public.update_own_profile(text, text)', 'execute') INTO v_auth_can_execute;
    SELECT has_function_privilege('authenticated', 'public.log_audit_event(uuid, text, text, jsonb)', 'execute') INTO v_auth_can_audit;
    SELECT has_function_privilege('anon', 'public.log_audit_event(uuid, text, text, jsonb)', 'execute') INTO v_anon_can_audit;

    IF v_anon_can_execute THEN
        RAISE NOTICE '[FAIL] Test 8: anon can execute update_own_profile!';
    ELSE
        RAISE NOTICE '[PASS] Test 8: anon cannot execute protected RPCs.';
    END IF;

    IF v_auth_can_execute THEN
        RAISE NOTICE '[PASS] Test 8: authenticated can execute public RPCs.';
    ELSE
        RAISE NOTICE '[FAIL] Test 8: authenticated cannot execute update_own_profile!';
    END IF;

    IF v_auth_can_audit OR v_anon_can_audit THEN
        RAISE NOTICE '[FAIL] Test 8: public/authenticated can execute log_audit_event!';
    ELSE
        RAISE NOTICE '[PASS] Test 8: log_audit_event execution fully restricted to internal.';
    END IF;
END $$;
