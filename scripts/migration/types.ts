export type UserRole = 'super_admin' | 'admin' | 'staff';
export type MemberType = 'MO' | 'EP';
export type RequestStatus = 'active' | 'old' | 'cancelled';
export type RequestApprovalStatus = 'pending_partner' | 'pending_admin' | 'approved' | 'rejected';
export type RequestType = 'Leave' | 'Swap';

export interface StagingUser {
    raw_id: number;
    import_batch_id: string | null;
    member_name: string | null;
    full_name: string | null;
    phone: string | null;
    active: string | null;
    staff_id: string | null;
    email: string | null;
    member_type: string | null;
}

export interface StagingShiftType {
    raw_id: number;
    import_batch_id: string | null;
    shift_id: string | null;
    name: string | null;
    is_public: string | null;
    group_id: string | null;
}

export interface StagingLimitGroup {
    raw_id: number;
    import_batch_id: string | null;
    group_id: string | null;
    group_name: string | null;
    default_limit: string | null;
}

export interface StagingShiftBlock {
    raw_id: number;
    import_batch_id: string | null;
    block_id: string | null;
    date: string | null;
    shift_type: string | null;
    max_slots: string | null;
}

export interface StagingRosterEntry {
    raw_id: number;
    import_batch_id: string | null;
    member_name: string | null;
    date: string | null;
    shifts: string | null;
}

export interface StagingRequest {
    raw_id: number;
    import_batch_id: string | null;
    request_id: string | null;
    timestamp: string | null;
    member_name: string | null;
    date: string | null;
    day: string | null;
    request_shift: string | null;
    status: string | null;
    comment: string | null;
    approval_status: string | null;
    swap_partner: string | null;
    request_type: string | null;
}

export interface StagingSetting {
    raw_id: number;
    import_batch_id: string | null;
    setting_key: string | null;
    setting_value: string | null;
}
