-- ==============================================================================
-- Hardened Schema Initialization (Final Correctness Pass)
-- ==============================================================================

-- 1. Create Enums
CREATE TYPE public.user_role AS ENUM ('super_admin', 'admin', 'staff');
CREATE TYPE public.member_type AS ENUM ('MO', 'EP');
CREATE TYPE public.request_status AS ENUM ('active', 'old', 'cancelled');
CREATE TYPE public.request_approval_status AS ENUM ('pending_partner', 'pending_admin', 'approved', 'rejected');
CREATE TYPE public.request_type AS ENUM ('Leave', 'Swap');

-- 2. Create Departments Table
CREATE TABLE public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create User Profiles Table (Maps to auth.users)
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    role public.user_role NOT NULL DEFAULT 'staff',
    member_type public.member_type NOT NULL DEFAULT 'MO',
    full_name TEXT,
    phone TEXT,
    staff_id TEXT,
    email TEXT UNIQUE NOT NULL,
    legacy_member_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Composite Keys for Department Isolation
    UNIQUE (id, department_id),
    UNIQUE (department_id, staff_id),
    UNIQUE (department_id, legacy_member_name)
);

-- 4. Create Limit Groups Table
CREATE TABLE public.limit_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    default_limit INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, name),
    UNIQUE (id, department_id)
);

-- 5. Create Shift Types Table
CREATE TABLE public.shift_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT true,
    limit_group_id UUID,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, name),
    UNIQUE (id, department_id),
    FOREIGN KEY (limit_group_id, department_id) REFERENCES public.limit_groups(id, department_id) ON DELETE RESTRICT
);

-- 6. Create Shift Blocks Table
CREATE TABLE public.shift_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_type_id UUID NOT NULL,
    max_slots INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, date, shift_type_id),
    FOREIGN KEY (shift_type_id, department_id) REFERENCES public.shift_types(id, department_id) ON DELETE CASCADE
);

-- 7. Create Roster Entries Table
CREATE TABLE public.roster_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    shift_type_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, date, shift_type_id),
    FOREIGN KEY (user_id, department_id) REFERENCES public.user_profiles(id, department_id) ON DELETE CASCADE,
    FOREIGN KEY (shift_type_id, department_id) REFERENCES public.shift_types(id, department_id) ON DELETE CASCADE
);

-- 8. Create Roster Snapshots Table
CREATE TABLE public.roster_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    month_key TEXT NOT NULL,
    published_by UUID,
    snapshot_data JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, month_key),
    FOREIGN KEY (published_by, department_id) REFERENCES public.user_profiles(id, department_id) ON DELETE RESTRICT
);

-- 9. Create Requests Table
CREATE TABLE public.requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    shift_type_id UUID NOT NULL,
    status public.request_status NOT NULL DEFAULT 'active',
    approval_status public.request_approval_status NOT NULL DEFAULT 'pending_admin',
    req_type public.request_type NOT NULL DEFAULT 'Leave',
    swap_partner_id UUID,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id, department_id) REFERENCES public.user_profiles(id, department_id) ON DELETE CASCADE,
    FOREIGN KEY (shift_type_id, department_id) REFERENCES public.shift_types(id, department_id) ON DELETE CASCADE,
    FOREIGN KEY (swap_partner_id, department_id) REFERENCES public.user_profiles(id, department_id) ON DELETE RESTRICT
);

-- 10. Create Settings Table
CREATE TABLE public.settings (
    key TEXT NOT NULL,
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key, department_id)
);

-- 11. Create Audit Logs Table
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_profiles_dept ON public.user_profiles(department_id);
CREATE INDEX idx_roster_entries_dept_date ON public.roster_entries(department_id, date);
CREATE INDEX idx_requests_dept_date ON public.requests(department_id, date);
CREATE INDEX idx_requests_user ON public.requests(user_id);

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER Helper Functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_user_role FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_department() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT department_id FROM public.user_profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_user_department FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_department TO authenticated;

-- -----------------------------------------------------------------------------
-- Privilege Escalation Triggers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_admin_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    -- Only super_admins can change roles
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF public.get_user_role() IS DISTINCT FROM 'super_admin' THEN
            RAISE EXCEPTION 'Only super admins can change user roles';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_escalation FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prevent_role_escalation
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_escalation();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limit_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Departments
CREATE POLICY "Departments are viewable by all authenticated users" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can manage departments" ON public.departments FOR ALL TO authenticated USING (public.get_user_role() = 'super_admin');

-- User Profiles
CREATE POLICY "Profiles viewable by same department" ON public.user_profiles FOR SELECT TO authenticated USING (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin');
-- Admins can manage profiles, BUT the trigger prevents them from upgrading roles
CREATE POLICY "Admins can manage profiles in their department" ON public.user_profiles FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'super_admin') AND (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin'));

-- Config Data
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['limit_groups', 'shift_types', 'shift_blocks', 'roster_snapshots', 'settings']) 
    LOOP
        EXECUTE format('CREATE POLICY "%I viewable by department staff" ON public.%I FOR SELECT TO authenticated USING (department_id = public.get_user_department() OR public.get_user_role() = ''super_admin'');', tbl, tbl);
        EXECUTE format('CREATE POLICY "%I managed by department admins" ON public.%I FOR ALL TO authenticated USING (public.get_user_role() IN (''admin'', ''super_admin'') AND (department_id = public.get_user_department() OR public.get_user_role() = ''super_admin''));', tbl, tbl);
    END LOOP;
END $$;

-- Roster Entries
CREATE POLICY "Roster viewable by department staff" ON public.roster_entries FOR SELECT TO authenticated USING (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin');
CREATE POLICY "Roster managed by department admins" ON public.roster_entries FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'super_admin') AND (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin'));

-- Requests (Select ONLY. Mutations strictly via RPC)
CREATE POLICY "Requests viewable by department staff" ON public.requests FOR SELECT TO authenticated USING (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin');

-- Audit Logs
CREATE POLICY "Admins can view department audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.get_user_role() IN ('admin', 'super_admin') AND (department_id = public.get_user_department() OR public.get_user_role() = 'super_admin'));


-- -----------------------------------------------------------------------------
-- RPC Functions (Strictly Hardened)
-- -----------------------------------------------------------------------------

-- Audit Log RPC (Internal Only)
CREATE OR REPLACE FUNCTION public.log_audit_event(p_department_id UUID, p_action TEXT, p_target TEXT, p_details JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO public.audit_logs (department_id, user_id, action, target, details)
    VALUES (p_department_id, auth.uid(), p_action, p_target, p_details);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_audit_event FROM PUBLIC, anon, authenticated;

-- Update Own Profile
CREATE OR REPLACE FUNCTION public.update_own_profile(p_phone TEXT, p_full_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_dept UUID;
BEGIN
    SELECT department_id INTO v_dept FROM public.user_profiles WHERE id = auth.uid();
    
    UPDATE public.user_profiles
    SET phone = COALESCE(p_phone, phone),
        full_name = COALESCE(p_full_name, full_name),
        updated_at = NOW()
    WHERE id = auth.uid();
    
    PERFORM public.log_audit_event(v_dept, 'UPDATE_PROFILE', 'user_profiles', jsonb_build_object('user_id', auth.uid()));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_own_profile FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile TO authenticated;

-- Create Request
CREATE OR REPLACE FUNCTION public.create_request(p_date DATE, p_shift_type_id UUID, p_req_type public.request_type, p_comment TEXT DEFAULT NULL, p_swap_partner_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_dept UUID;
    v_new_id UUID;
BEGIN
    v_dept := public.get_user_department();
    IF v_dept IS NULL THEN
        RAISE EXCEPTION 'User not assigned to a department';
    END IF;

    INSERT INTO public.requests (department_id, user_id, date, shift_type_id, status, approval_status, req_type, swap_partner_id, comment)
    VALUES (v_dept, auth.uid(), p_date, p_shift_type_id, 'active', 'pending_admin', p_req_type, p_swap_partner_id, p_comment)
    RETURNING id INTO v_new_id;

    PERFORM public.log_audit_event(v_dept, 'CREATE_REQUEST', 'requests', jsonb_build_object('request_id', v_new_id));
    RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_request TO authenticated;

-- Cancel Own Request
CREATE OR REPLACE FUNCTION public.cancel_own_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_dept UUID;
BEGIN
    v_dept := public.get_user_department();

    UPDATE public.requests
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_request_id AND user_id = auth.uid() AND status = 'active';

    IF FOUND THEN
        PERFORM public.log_audit_event(v_dept, 'CANCEL_REQUEST', 'requests', jsonb_build_object('request_id', p_request_id));
    ELSE
        RAISE EXCEPTION 'Request not found or not active';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_own_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_own_request TO authenticated;

-- Admin Approve Request
CREATE OR REPLACE FUNCTION public.admin_approve_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_role public.user_role;
    v_target_dept UUID;
BEGIN
    v_role := public.get_user_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT department_id INTO v_target_dept FROM public.requests WHERE id = p_request_id;
    
    IF v_role = 'admin' AND v_target_dept != public.get_user_department() THEN
        RAISE EXCEPTION 'Request not in your department';
    END IF;

    UPDATE public.requests
    SET approval_status = 'approved', updated_at = NOW()
    WHERE id = p_request_id;

    IF FOUND THEN
        PERFORM public.log_audit_event(v_target_dept, 'APPROVE_REQUEST', 'requests', jsonb_build_object('request_id', p_request_id));
    ELSE
        RAISE EXCEPTION 'Request not found';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_approve_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_request TO authenticated;

-- Admin Reject Request
CREATE OR REPLACE FUNCTION public.admin_reject_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_role public.user_role;
    v_target_dept UUID;
BEGIN
    v_role := public.get_user_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT department_id INTO v_target_dept FROM public.requests WHERE id = p_request_id;
    
    IF v_role = 'admin' AND v_target_dept != public.get_user_department() THEN
        RAISE EXCEPTION 'Request not in your department';
    END IF;

    UPDATE public.requests
    SET approval_status = 'rejected', updated_at = NOW()
    WHERE id = p_request_id;

    IF FOUND THEN
        PERFORM public.log_audit_event(v_target_dept, 'REJECT_REQUEST', 'requests', jsonb_build_object('request_id', p_request_id));
    ELSE
        RAISE EXCEPTION 'Request not found';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_reject_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_request TO authenticated;

-- -----------------------------------------------------------------------------
-- Triggers for updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column FROM PUBLIC, anon, authenticated;

DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['departments', 'user_profiles', 'limit_groups', 'shift_types', 'shift_blocks', 'roster_entries', 'requests', 'settings']) 
    LOOP
        EXECUTE format('CREATE TRIGGER update_%I_modtime BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', tbl, tbl);
    END LOOP;
END $$;
