import { useState, useMemo, useEffect } from 'react';
import { buildUserMonthlyUsage } from '../utils/quota';

export default function AdminPanel({
  requests = [],
  shiftBlocks = [],
  names = [],
  teamMembers = [],
  emergencyPhysicians = [],
  onUpdateApproval,
  onAddBlock,
  onDeleteBlock,
  shiftTypes = [],
  onAddShiftType,
  onUpdateShiftType,
  onDeleteShiftType,
  onReorderShiftTypes,
  limitGroups = [],
  onAddLimitGroup,
  onUpdateLimitGroup,
  onDeleteLimitGroup,
  activities = [],
  onAddActivity,
  onDeleteActivity,
  settings = {},
  onUpdateSetting,
  onUpdateTeamMembers,
  onUpdateEmergencyPhysicians,
}) {

  // Shift block inputs
  const [blockDate, setBlockDate] = useState('');
  const [blockGroupId, setBlockGroupId] = useState('');
  const [blockMaxSlots, setBlockMaxSlots] = useState('0'); // 0 = completely blocked

  // Shift Types inputs
  const [newShiftName, setNewShiftName] = useState('');
  const [newShiftIsPublic, setNewShiftIsPublic] = useState(true);
  const [newShiftGroupId, setNewShiftGroupId] = useState('');

  // Shift Types – inline edit & local ordered list
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [editShiftName, setEditShiftName] = useState('');
  const [editShiftIsPublic, setEditShiftIsPublic] = useState(true);
  const [editShiftGroupId, setEditShiftGroupId] = useState('');
  const [localShiftTypes, setLocalShiftTypes] = useState(shiftTypes);
  const [isSavingShiftEdit, setIsSavingShiftEdit] = useState(false);
  const [isReorderingShift, setIsReorderingShift] = useState(false);

  // Limit Groups inputs
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupLimit, setNewGroupLimit] = useState('3');

  // Activity history manager inputs
  const [actType, setActType] = useState('announcement');
  const [actCustomText, setActCustomText] = useState('');
  const [actName, setActName] = useState('');
  const [actRequestType, setActRequestType] = useState('Off-Duty');
  const [actDate, setActDate] = useState('');
  const [actApprovalStatus, setActApprovalStatus] = useState('Approved');
  const [actRequest, setActRequest] = useState('');
  const [actSwapPartner, setActSwapPartner] = useState('');
  const [actComment, setActComment] = useState('');
  const [actMemberShiftType, setActMemberShiftType] = useState('');
  const [actSwapPartnerDate, setActSwapPartnerDate] = useState('');
  const [actSwapPartnerShiftType, setActSwapPartnerShiftType] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Settings inputs
  const [monthlyRequestLimitInput, setMonthlyRequestLimitInput] = useState(() => {
    return settings?.monthly_request_limit || '10';
  });
  const [monthlyWeekendLimitInput, setMonthlyWeekendLimitInput] = useState(() => {
    return settings?.monthly_weekend_limit || '4';
  });
  const [weekendLimitGroupIdInput, setWeekendLimitGroupIdInput] = useState(() => {
    return settings?.weekend_limit_group_id || 'ALL';
  });
  const [quotaOverviewMonth, setQuotaOverviewMonth] = useState(() => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);

  // Team members states
  const [localTeamMembers, setLocalTeamMembers] = useState(() => {
    if (teamMembers && teamMembers.length > 0) return teamMembers;
    return names.map(n => ({ name: n, fullName: '', phone: '', active: true }));
  });
  const [localEmergencyPhysicians, setLocalEmergencyPhysicians] = useState(() => emergencyPhysicians || []);
  const [isSavingTeamMembers, setIsSavingTeamMembers] = useState(false);
  const [isSavingEmergencyPhysicians, setIsSavingEmergencyPhysicians] = useState(false);
  const [activeAdminPage, setActiveAdminPage] = useState('overview');

  // Modal form states
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberModalMode, setMemberModalMode] = useState('add'); // 'add' or 'edit'
  const [memberModalDirectory, setMemberModalDirectory] = useState('team'); // 'team' or 'ep'
  const [memberModalOriginalName, setMemberModalOriginalName] = useState('');
  const [memberModalName, setMemberModalName] = useState('');
  const [memberModalFullName, setMemberModalFullName] = useState('');
  const [memberModalPhone, setMemberModalPhone] = useState('');
  const [memberModalActive, setMemberModalActive] = useState(true);

  // Keep localTeamMembers in sync with teamMembers/names prop when it changes
  useEffect(() => {
    if (teamMembers && teamMembers.length > 0) {
      setLocalTeamMembers(teamMembers);
    } else {
      setLocalTeamMembers(names.map(n => ({ name: n, fullName: '', phone: '', active: true })));
    }
  }, [teamMembers, names]);

  useEffect(() => {
    setLocalEmergencyPhysicians(emergencyPhysicians || []);
  }, [emergencyPhysicians]);

  // Close modal on Escape key press
  useEffect(() => {
    if (!isMemberModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsMemberModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMemberModalOpen]);

  const handleOpenAddModal = (directory = 'team') => {
    setMemberModalMode('add');
    setMemberModalDirectory(directory);
    setMemberModalOriginalName('');
    setMemberModalName('');
    setMemberModalFullName('');
    setMemberModalPhone('');
    setMemberModalActive(true);
    setIsMemberModalOpen(true);
  };

  const handleOpenEditModal = (member, directory = 'team') => {
    setMemberModalMode('edit');
    setMemberModalDirectory(directory);
    setMemberModalOriginalName(member.name);
    setMemberModalName(member.name);
    setMemberModalFullName(member.fullName || '');
    setMemberModalPhone(member.phone || '');
    setMemberModalActive(member.active !== false);
    setIsMemberModalOpen(true);
  };

  const handleSaveMemberModal = async (e) => {
    if (e) e.preventDefault();
    const cleanName = memberModalName.trim();
    const cleanFullName = memberModalFullName.trim();
    const cleanPhone = memberModalPhone.trim();
    if (!cleanName) return;
    const activeMembers = memberModalDirectory === 'ep' ? localEmergencyPhysicians : localTeamMembers;

    // Check duplicate
    const isDuplicate = activeMembers.some(m => {
      if (memberModalMode === 'edit' && m.name.toLowerCase() === memberModalOriginalName.toLowerCase()) {
        return false;
      }
      return m.name.toLowerCase() === cleanName.toLowerCase();
    });

    if (isDuplicate) {
      alert(`"${cleanName}" is already in the list.`);
      return;
    }

    let updatedMembers;
    const savedMember = {
      name: cleanName,
      fullName: cleanFullName,
      phone: cleanPhone,
      active: memberModalDirectory === 'team' ? memberModalActive : true,
    };
    if (memberModalMode === 'add') {
      updatedMembers = [...activeMembers, savedMember];
    } else {
      updatedMembers = activeMembers.map(m => 
        m.name.toLowerCase() === memberModalOriginalName.toLowerCase()
          ? savedMember
          : m
      );
    }

    if (memberModalDirectory === 'ep') {
      setLocalEmergencyPhysicians(updatedMembers);
      setIsMemberModalOpen(false);
      setIsSavingEmergencyPhysicians(true);
      try {
        await onUpdateEmergencyPhysicians(updatedMembers);
      } catch (err) {
        setLocalEmergencyPhysicians(emergencyPhysicians || []);
      } finally {
        setIsSavingEmergencyPhysicians(false);
      }
      return;
    }

    setLocalTeamMembers(updatedMembers);
    setIsMemberModalOpen(false);
    setIsSavingTeamMembers(true);
    try {
      await onUpdateTeamMembers(updatedMembers);
    } catch (err) {
      if (teamMembers && teamMembers.length > 0) {
        setLocalTeamMembers(teamMembers);
      } else {
        setLocalTeamMembers(names.map(n => ({ name: n, fullName: '', phone: '', active: true })));
      }
    } finally {
      setIsSavingTeamMembers(false);
    }
  };

  const handleDeleteMember = async (nameToDelete) => {
    if (!confirm(`Are you sure you want to remove "${nameToDelete}"? This will not delete their historical request logs, but they will no longer appear in name selectors.`)) {
      return;
    }
    const updatedMembers = localTeamMembers.filter(m => m.name !== nameToDelete);
    setLocalTeamMembers(updatedMembers);
    setIsSavingTeamMembers(true);
    try {
      await onUpdateTeamMembers(updatedMembers);
    } catch (err) {
      if (teamMembers && teamMembers.length > 0) {
        setLocalTeamMembers(teamMembers);
      } else {
        setLocalTeamMembers(names.map(n => ({ name: n, fullName: '', phone: '', active: true })));
      }
    } finally {
      setIsSavingTeamMembers(false);
    }
  };

  const handleToggleMemberActive = async (member) => {
    const updatedMembers = localTeamMembers.map(m =>
      m.name === member.name ? { ...m, active: m.active === false } : m
    );
    setLocalTeamMembers(updatedMembers);
    setIsSavingTeamMembers(true);
    try {
      await onUpdateTeamMembers(updatedMembers);
    } catch (err) {
      if (teamMembers && teamMembers.length > 0) {
        setLocalTeamMembers(teamMembers);
      } else {
        setLocalTeamMembers(names.map(n => ({ name: n, fullName: '', phone: '', active: true })));
      }
    } finally {
      setIsSavingTeamMembers(false);
    }
  };

  const handleDeleteEmergencyPhysician = async (nameToDelete) => {
    if (!confirm(`Are you sure you want to remove "${nameToDelete}" from the emergency physicians directory?`)) {
      return;
    }
    const updatedMembers = localEmergencyPhysicians.filter(m => m.name !== nameToDelete);
    setLocalEmergencyPhysicians(updatedMembers);
    setIsSavingEmergencyPhysicians(true);
    try {
      await onUpdateEmergencyPhysicians(updatedMembers);
    } catch (err) {
      setLocalEmergencyPhysicians(emergencyPhysicians || []);
    } finally {
      setIsSavingEmergencyPhysicians(false);
    }
  };

  useEffect(() => {
    if (settings?.monthly_request_limit) {
      setMonthlyRequestLimitInput(settings.monthly_request_limit);
    }
    if (settings?.monthly_weekend_limit) {
      setMonthlyWeekendLimitInput(settings.monthly_weekend_limit);
    }
    if (settings?.weekend_limit_group_id) {
      setWeekendLimitGroupIdInput(settings.weekend_limit_group_id);
    }
  }, [settings]);

  // Keep localShiftTypes in sync when prop changes (after server refresh)
  useEffect(() => {
    setLocalShiftTypes(shiftTypes);
  }, [shiftTypes]);

  const startEditShift = (st) => {
    setEditingShiftId(st.ID);
    setEditShiftName(st.Name);
    setEditShiftIsPublic(st.IsPublic);
    setEditShiftGroupId(st.GroupID || '');
  };

  const cancelEditShift = () => {
    setEditingShiftId(null);
  };

  const saveEditShift = async (st) => {
    if (!editShiftName.trim()) return;
    setIsSavingShiftEdit(true);
    // Optimistic update locally
    setLocalShiftTypes(prev =>
      prev.map(s => s.ID === st.ID
        ? { ...s, Name: editShiftName.trim().toUpperCase(), IsPublic: editShiftIsPublic, GroupID: editShiftGroupId }
        : s
      )
    );
    setEditingShiftId(null);
    try {
      await onUpdateShiftType(st.ID, { name: editShiftName.trim(), isPublic: editShiftIsPublic, groupId: editShiftGroupId });
    } catch (e) {
      // revert on error
      setLocalShiftTypes(shiftTypes);
    }
    setIsSavingShiftEdit(false);
  };

  const moveShift = async (index, direction) => {
    const newList = [...localShiftTypes];
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= newList.length) return;
    [newList[index], newList[swapIdx]] = [newList[swapIdx], newList[index]];
    setLocalShiftTypes(newList);
    setIsReorderingShift(true);
    try {
      await onReorderShiftTypes(newList.map(s => s.ID));
    } catch (e) {
      setLocalShiftTypes(shiftTypes); // revert
    }
    setIsReorderingShift(false);
  };

  const handleAddActivitySubmit = (e) => {
    e.preventDefault();
    if (actType === 'announcement') {
      if (!actCustomText.trim()) {
        alert('Please fill out announcement text.');
        return;
      }
      onAddActivity({
        customText: actCustomText.trim(),
      });
      setActCustomText('');
    } else {
      if (actRequestType === 'Swap') {
        if (!actName || !actDate || !actMemberShiftType || !actSwapPartner || !actSwapPartnerDate || !actSwapPartnerShiftType) {
          alert('Please fill out all swap details (names, dates, shift types).');
          return;
        }
        const isSameDay = actDate === actSwapPartnerDate;
        let customText = '';
        if (isSameDay) {
          customText = `SWAP ALERT! [${actDate}] ${actName} (${actMemberShiftType}) ↔ ${actSwapPartner} (${actSwapPartnerShiftType})`;
        } else {
          customText = `SWAP ALERT! [${actDate}] ${actName} (${actMemberShiftType}) ↔ [${actSwapPartnerDate}] ${actSwapPartner} (${actSwapPartnerShiftType})`;
        }

        onAddActivity({
          customText,
          requestType: 'Swap',
          name: actName,
          swapPartner: actSwapPartner,
          date: actDate,
          approvalStatus: 'Approved',
          comment: actComment,
        });
      } else {
        if (!actName || !actDate) {
          alert('Please fill out Name and Date.');
          return;
        }
        if (!actRequest) {
          alert('Please enter shift name.');
          return;
        }
        onAddActivity({
          name: actName,
          requestType: actRequestType,
          date: actDate,
          request: actRequest,
          approvalStatus: 'Approved',
          comment: actComment,
        });
      }

      // reset form
      setActName('');
      setActDate('');
      setActRequest('');
      setActSwapPartner('');
      setActComment('');
      setActMemberShiftType('');
      setActSwapPartnerDate('');
      setActSwapPartnerShiftType('');
    }
  };

  // 1. Queue of requests waiting for ADMIN approval
  // NOTE: Approval workflow is disabled for now — roster is finalised externally.
  // Set APPROVAL_WORKFLOW_ENABLED = true to re-enable when needed.
  const APPROVAL_WORKFLOW_ENABLED = false;

  const adminQueue = useMemo(() => {
    return requests.filter(
      (r) => r.status?.toLowerCase() === 'active' && r.ApprovalStatus === 'Pending Admin'
    );
  }, [requests]);

  // Group ALL users' requests by user and by month
  const userMonthlyUsage = useMemo(() => {
    return buildUserMonthlyUsage({
      requests,
      names,
      settings,
      quotaOverviewMonth,
      shiftTypes: localShiftTypes,
    });
  }, [requests, names, settings, quotaOverviewMonth, localShiftTypes]);

  const handleAddBlockSubmit = (e) => {
    e.preventDefault();
    if (!blockDate || !blockGroupId) {
      alert('Please fill out date and select a limit group.');
      return;
    }
    onAddBlock({
      date: blockDate,
      shiftType: blockGroupId, // Storing GroupID in the ShiftType column of ShiftBlocks
      maxSlots: Number(blockMaxSlots),
    });
    setBlockDate('');
  };

  const handleAddShiftTypeSubmit = (e) => {
    e.preventDefault();
    if (!newShiftName.trim()) {
      alert('Please enter a shift type name.');
      return;
    }
    onAddShiftType({
      name: newShiftName.trim(),
      isPublic: newShiftIsPublic,
      groupId: newShiftGroupId,
    });
    setNewShiftName('');
    setNewShiftIsPublic(true);
    setNewShiftGroupId('');
  };

  const handleAddLimitGroupSubmit = (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      alert('Please enter a limit group name.');
      return;
    }
    onAddLimitGroup({
      groupName: newGroupName.trim(),
      defaultLimit: Number(newGroupLimit),
    });
    setNewGroupName('');
    setNewGroupLimit('3');
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!onUpdateSetting) return;
    setIsUpdatingSettings(true);
    try {
      await onUpdateSetting('monthly_request_limit', monthlyRequestLimitInput);
      await onUpdateSetting('monthly_weekend_limit', monthlyWeekendLimitInput);
      await onUpdateSetting('weekend_limit_group_id', weekendLimitGroupIdInput);
    } catch (err) {
      alert(err.message || 'Failed to update settings');
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const adminPages = [
    { key: 'overview', label: 'Overview' },
    { key: 'team', label: 'Team Members' },
    { key: 'shifts', label: 'Shift Setup' },
    { key: 'rules', label: 'Limit Rules' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800">🔑 Roster Administration Panel</h1>
        <p className="text-sm text-slate-500 mt-1">
          Perform administrative changes, oversee change submissions, customize date caps, and configure shift quotas.
        </p>
      </div>

      {/* 📢 Activity & Announcement Manager — moved to top */}
      <div className="mb-8 overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max gap-2">
          {adminPages.map((page) => {
            const isActive = activeAdminPage === page.key;
            return (
              <button
                key={page.key}
                type="button"
                onClick={() => setActiveAdminPage(page.key)}
                className={`rounded-t-xl border border-b-0 px-4 py-2 text-xs font-bold transition ${
                  isActive
                    ? 'border-indigo-200 bg-white text-indigo-700 shadow-sm'
                    : 'border-transparent bg-transparent text-slate-500 hover:bg-white/70 hover:text-slate-700'
                }`}
              >
                {page.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${activeAdminPage === 'activity' ? 'mb-8' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
        <h2 className="text-xl font-bold text-slate-800 mb-2">📢 Manage Activity History &amp; Bulletins</h2>
        <p className="text-xs text-slate-400 mb-6">
          Add custom alerts or request logs that will be displayed in the scrolling announcement banner and updates timeline.
        </p>

        <div className="grid gap-8 md:grid-cols-3">
          {/* Form: Add Announcement / Custom Alert */}
          <div className="md:col-span-1 border-r border-slate-100 pr-0 md:pr-8 space-y-4">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Add Update Row</h3>
            
            <form onSubmit={handleAddActivitySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Update Type
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActType('announcement')}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition border ${
                      actType === 'announcement'
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Megaphone 📢
                  </button>
                  <button
                    type="button"
                    onClick={() => setActType('log')}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition border ${
                      actType === 'log'
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Roster Event 📅
                  </button>
                </div>
              </div>

              {actType === 'announcement' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Announcement Message (megaphoned)
                  </label>
                  <textarea
                    rows="3"
                    value={actCustomText}
                    onChange={(e) => setActCustomText(e.target.value)}
                    required
                    placeholder="e.g. 📢 The upcoming June Roster is now published and open for swap request submissions!"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Request Type
                    </label>
                    <select
                      value={actRequestType}
                      onChange={(e) => setActRequestType(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                    >
                      <option value="Off-Duty">Off-Duty</option>
                      <option value="Swap">Swap</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Member Name
                    </label>
                    <select
                      value={actName}
                      onChange={(e) => setActName(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                    >
                      <option value="" disabled>Select Member</option>
                      {names.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {actRequestType === 'Swap' ? (
                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Shift Date
                          </label>
                          <input
                            type="date"
                            value={actDate}
                            onChange={(e) => setActDate(e.target.value)}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Shift Type
                          </label>
                          <input
                            type="text"
                            value={actMemberShiftType}
                            onChange={(e) => setActMemberShiftType(e.target.value)}
                            required
                            placeholder="e.g. AM"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Swap Partner
                        </label>
                        <select
                          value={actSwapPartner}
                          onChange={(e) => setActSwapPartner(e.target.value)}
                          required
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                        >
                          <option value="" disabled>Select Partner</option>
                          {names.map(name => (
                            name !== actName && (
                              <option key={name} value={name}>{name}</option>
                            )
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Partner Shift Date
                          </label>
                          <input
                            type="date"
                            value={actSwapPartnerDate}
                            onChange={(e) => setActSwapPartnerDate(e.target.value)}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Partner Shift Type
                          </label>
                          <input
                            type="text"
                            value={actSwapPartnerShiftType}
                            onChange={(e) => setActSwapPartnerShiftType(e.target.value)}
                            required
                            placeholder="e.g. PM"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Shift Date
                        </label>
                        <input
                          type="date"
                          value={actDate}
                          onChange={(e) => setActDate(e.target.value)}
                          required
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Requested Shift
                        </label>
                        <input
                          type="text"
                          value={actRequest}
                          onChange={(e) => setActRequest(e.target.value)}
                          required
                          placeholder="e.g. AM, Night"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Comment (Optional)
                    </label>
                    <input
                      type="text"
                      value={actComment}
                      onChange={(e) => setActComment(e.target.value)}
                      placeholder="Comment/Reason..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 text-xs transition"
              >
                📢 Post Update Event
              </button>
            </form>
          </div>

          {/* List of current announcements and update logs */}
          <div className="md:col-span-2 space-y-4">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Posted Activities ({activities.length})</h3>
            
            {activities.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-2 space-y-3">
                {activities.map((act) => {
                  const isCustom = !!act.CustomText && !act.RequestType;
                  return (
                    <div key={act.ID} className="flex items-start justify-between py-3 text-xs gap-4 border-b border-slate-100 last:border-0">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isCustom ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {isCustom ? '📢 Announcement' : '📅 Roster Log'}
                          </span>
                          {act.Timestamp && (
                            <span className="text-[10px] text-slate-400">
                              {new Date(act.Timestamp).toLocaleString()}
                            </span>
                          )}
                        </div>

                        {isCustom ? (
                          <p className="text-sm text-slate-800 font-semibold">{act.CustomText}</p>
                        ) : (
                          <p className="text-sm text-slate-800">
                            {act.CustomText && act.RequestType === 'Swap' ? (
                              <span className="font-semibold">{act.CustomText}</span>
                            ) : (
                              <>
                                <strong>{act.Name}</strong>{' '}
                                {act.RequestType?.toLowerCase() === 'swap' ? (
                                  <span>swapped shift with <strong>{act.SwapPartner}</strong></span>
                                ) : (
                                  <span>requested off-duty for <strong>{act.Request}</strong></span>
                                )}{' '}
                                on <strong>{act.Date}</strong> ({act.ApprovalStatus || 'Approved'})
                              </>
                            )}
                            {act.Comment && <span className="block text-xs text-slate-500 italic mt-1">"{act.Comment}"</span>}
                          </p>
                        )}
                      </div>

                      <div className="self-center shrink-0">
                        {confirmDeleteId === act.ID ? (
                          <div className="flex items-center gap-2 bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">
                            <span className="text-[10px] font-bold text-rose-700">Confirm?</span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteActivity(act.ID);
                                setConfirmDeleteId(null);
                              }}
                              className="text-white bg-rose-500 hover:bg-rose-600 px-2 py-1 rounded text-[10px] font-bold transition"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-slate-600 bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded text-[10px] font-bold transition"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setConfirmDeleteId(act.ID);
                            }}
                            className="text-rose-500 font-bold hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                <span className="text-2xl">📭</span>
                <p className="mt-1 text-xs font-semibold">No dynamic announcements are stored in Google Sheets.</p>
                <p className="text-[10px] text-slate-400 mt-1">Use the left form to post an update!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`${['team', 'shifts', 'rules'].includes(activeAdminPage) ? 'grid' : 'hidden'} gap-8 ${activeAdminPage === 'rules' ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
        
        {/* Left Column: Operations */}
        <div className="space-y-8">
          {/* Roster Approval Requests Queue — hidden until approval workflow is activated */}
          {APPROVAL_WORKFLOW_ENABLED && (
          <div className={`${activeAdminPage === 'rules' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">📋 Roster Approval Requests Queue</h2>
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
                {adminQueue.length} Pending
              </span>
            </div>

            {adminQueue.length > 0 ? (
              <div className="space-y-4">
                {adminQueue.map((req) => {
                  const isSwap = req.RequestType?.toLowerCase() === 'swap';
                  
                  return (
                    <div 
                      key={req.ID}
                      className="rounded-2xl border border-slate-100 p-4 shadow-inner bg-slate-50/50 hover:bg-slate-50 transition"
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                        <span>{req.Date}</span>
                        <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] text-indigo-600 uppercase border border-indigo-100">
                          {req.RequestType || 'Leave'}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-slate-800">
                        <span className="font-bold text-slate-900">{req.Name}</span>
                        {isSwap ? (
                          <span> swaps duty shifts with <span className="font-bold text-slate-900">{req.SwapPartner}</span>.</span>
                        ) : (
                          <span> requested off duty for: <span className="font-bold text-slate-900">{req.Request}</span>.</span>
                        )}
                      </p>

                      {req.Comment && (
                        <p className="mt-2 text-xs italic text-slate-500">"{req.Comment}"</p>
                      )}

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => onUpdateApproval(req.ID, 'Approved')}
                          className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 text-xs transition"
                        >
                          ✅ Approve & Override
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateApproval(req.ID, 'Rejected')}
                          className="flex-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold py-2 text-xs transition"
                        >
                          ❌ Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                <span className="text-3xl">☕</span>
                <p className="mt-2 text-sm font-semibold">Your queue is fully cleared! Time to rest.</p>
              </div>
            )}
          </div>
          )} {/* end APPROVAL_WORKFLOW_ENABLED */}

          {/* Date-Specific Shift Blocker Console */}
          <div className={`${activeAdminPage === 'rules' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <h2 className="text-lg font-bold text-slate-800 mb-4">🛑 Date-Specific Shift Blocker</h2>
            
            <form onSubmit={handleAddBlockSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Block Date
                  </label>
                  <input
                    type="date"
                    value={blockDate}
                    onChange={(e) => setBlockDate(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Limit Group Cap
                  </label>
                  <select
                    value={blockGroupId}
                    onChange={(e) => setBlockGroupId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  >
                    <option value="" disabled>Select a Limit Group</option>
                    {limitGroups.map(lg => (
                      <option key={lg.ID} value={lg.ID}>{lg.GroupName} (Default limit: {lg.DefaultLimit})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Max Available Slots (0 = Fully Blocked)
                </label>
                <input
                  type="number"
                  min="0"
                  value={blockMaxSlots}
                  onChange={(e) => setBlockMaxSlots(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 text-xs transition"
              >
                🔒 Apply Shift Limitation Rule
              </button>
            </form>

            {/* List Active Blocks */}
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Active Rules</h3>
              {shiftBlocks.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {shiftBlocks.map((block) => {
                    const group = limitGroups.find(lg => lg.ID === block.ShiftType);
                    const groupName = group ? group.GroupName : block.ShiftType;
                    return (
                      <div key={block.ID} className="flex items-center justify-between py-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-800">{block.Date}</span>
                          <span className="ml-2 font-semibold text-slate-500">
                            Group '{groupName}' cap: {block.MaxSlots}
                          </span>
                        </div>
                      <button
                        type="button"
                        onClick={() => onDeleteBlock(block.ID)}
                        className="text-rose-500 font-bold hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs italic text-slate-400">No active limit caps applied.</p>
              )}
            </div>
          </div>

          {/* 👥 Team Members Directory Card */}
          <div className={`${activeAdminPage === 'team' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">👥 Team Members Directory</h2>
              <button
                type="button"
                onClick={() => handleOpenAddModal('team')}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 text-xs transition whitespace-nowrap"
              >
                ➕ Add Member
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-6">
              Add, edit, or remove roster participants. Names here populate the onboarding selection and request fields.
            </p>

            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-t border-slate-100 pt-6">
              Members ({localTeamMembers.filter(member => member.active !== false).length} active / {localTeamMembers.length} total)
            </h3>

            {localTeamMembers.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                {localTeamMembers.map((member, idx) => {
                  return (
                    <div
                      key={member.name || idx}
                      className="py-3 text-xs flex items-center justify-between hover:bg-slate-50/50 transition rounded-lg px-2 -mx-2"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-bold text-slate-800 text-sm truncate">{member.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${member.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                            {member.active === false ? 'Inactive' : 'Active'}
                          </span>
                          {member.phone && (
                            <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                              📞 {member.phone}
                            </span>
                          )}
                        </div>
                        {member.fullName && (
                          <span className="block text-[11px] text-slate-400 mt-0.5 font-medium truncate">
                            {member.fullName}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleMemberActive(member)}
                          disabled={isSavingTeamMembers}
                          className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${member.active === false ? 'border-emerald-100 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                        >
                          {member.active === false ? 'Set Active' : 'Set Inactive'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(member)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMember(member.name)}
                          className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-500 hover:bg-rose-100 transition"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">No team members in database.</p>
            )}
          </div>

          {/* Emergency Physicians Directory Card */}
          <div className={`${activeAdminPage === 'team' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Emergency Physicians Directory</h2>
              <button
                type="button"
                onClick={() => handleOpenAddModal('ep')}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 text-xs transition whitespace-nowrap"
              >
                Add EP
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-6">
              Add, edit, or remove EP contact details used for roster PDF export contact boxes.
            </p>

            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-t border-slate-100 pt-6">
              Active EPs ({localEmergencyPhysicians.length})
            </h3>

            {localEmergencyPhysicians.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                {localEmergencyPhysicians.map((member, idx) => {
                  return (
                    <div
                      key={member.name || idx}
                      className="py-3 text-xs flex items-center justify-between hover:bg-slate-50/50 transition rounded-lg px-2 -mx-2"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-bold text-slate-800 text-sm truncate">{member.name}</span>
                          {member.phone && (
                            <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                              Phone {member.phone}
                            </span>
                          )}
                        </div>
                        {member.fullName && (
                          <span className="block text-[11px] text-slate-400 mt-0.5 font-medium truncate">
                            {member.fullName}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(member, 'ep')}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEmergencyPhysician(member.name)}
                          className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-500 hover:bg-rose-100 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">No emergency physicians in database.</p>
            )}
          </div>

        </div>{/* end left column */}

        {/* Right Column: Configuration */}
        <div className="space-y-8">

          {/* Shift Types Management Card */}
          <div className={`${activeAdminPage === 'shifts' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <h2 className="text-lg font-bold text-slate-800 mb-4">⚙️ Shift Types Configuration</h2>
            
            <form onSubmit={handleAddShiftTypeSubmit} className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  New Shift Name (e.g. AM, AL, MC)
                </label>
                <input
                  type="text"
                  value={newShiftName}
                  onChange={(e) => setNewShiftName(e.target.value)}
                  placeholder="e.g. EL"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <input
                    type="checkbox"
                    checked={newShiftIsPublic}
                    onChange={(e) => setNewShiftIsPublic(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-700">Public visibility</div>
                    <div className="text-[10px] text-slate-400">Regular users can see it</div>
                  </div>
                </label>

                <div className="flex flex-col bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <label className="text-xs font-bold text-slate-700 mb-2">Limit Group</label>
                  <select
                    value={newShiftGroupId}
                    onChange={(e) => setNewShiftGroupId(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-400"
                  >
                    <option value="">None (Unlimited)</option>
                    {limitGroups.map(lg => (
                      <option key={lg.ID} value={lg.ID}>{lg.GroupName}</option>
                    ))}
                  </select>
                  <div className="text-[10px] text-slate-400 mt-1">Pools quota with this group</div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 text-xs transition"
              >
                ➕ Add Shift Type
              </button>
            </form>

            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-t border-slate-100 pt-6 flex items-center gap-2">
              Active Shift Types
              {isReorderingShift && <span className="text-[10px] font-normal text-indigo-400 animate-pulse">Saving order…</span>}
            </h3>

            {localShiftTypes.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                {localShiftTypes.map((st, idx) => {
                  const group = limitGroups.find(lg => lg.ID === st.GroupID);
                  const isEditing = editingShiftId === st.ID;
                  return (
                    <div
                      key={st.ID}
                      className={`py-3 text-xs transition-colors ${isEditing ? 'bg-indigo-50/60 rounded-xl px-3 -mx-1' : ''}`}
                    >
                      {isEditing ? (
                        /* ── EDIT MODE ── */
                        <div className="space-y-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Name</label>
                            <input
                              type="text"
                              value={editShiftName}
                              onChange={e => setEditShiftName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEditShift(st); if (e.key === 'Escape') cancelEditShift(); }}
                              autoFocus
                              className="w-full rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <div
                                onClick={() => setEditShiftIsPublic(v => !v)}
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                                  editShiftIsPublic ? 'bg-emerald-500' : 'bg-slate-300'
                                }`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                                  editShiftIsPublic ? 'translate-x-4' : 'translate-x-0'
                                }`} />
                              </div>
                              <span className={`text-[11px] font-bold ${editShiftIsPublic ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {editShiftIsPublic ? '👁️ Public' : '🔒 Admin Only'}
                              </span>
                            </label>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quota Group</label>
                            <select
                              value={editShiftGroupId}
                              onChange={e => setEditShiftGroupId(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold outline-none focus:border-indigo-400"
                            >
                              <option value="">— None —</option>
                              {limitGroups.map(lg => (
                                <option key={lg.ID} value={lg.ID}>{lg.GroupName}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => saveEditShift(st)}
                              disabled={isSavingShiftEdit || !editShiftName.trim()}
                              className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-bold py-1.5 transition"
                            >
                              {isSavingShiftEdit ? 'Saving…' : '✓ Save'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditShift}
                              className="flex-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-bold py-1.5 transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── VIEW MODE ── */
                        <div className="flex items-center gap-2">
                          {/* Up/Down reorder buttons */}
                          <div className="flex flex-col gap-0.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => moveShift(idx, -1)}
                              disabled={idx === 0 || isReorderingShift}
                              title="Move up"
                              className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-25 transition text-[10px] leading-none"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => moveShift(idx, 1)}
                              disabled={idx === localShiftTypes.length - 1 || isReorderingShift}
                              title="Move down"
                              className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-25 transition text-[10px] leading-none"
                            >
                              ▼
                            </button>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <span className="block font-bold text-slate-800 text-sm truncate">{st.Name}</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                st.IsPublic ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                              }`}>
                                {st.IsPublic ? '👁️ Public' : '🔒 Admin Only'}
                              </span>
                              {group && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                                  ⚡ {group.GroupName}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditShift(st)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Delete shift type "${st.Name}"?`)) onDeleteShiftType(st.ID);
                              }}
                              className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-500 hover:bg-rose-100 transition"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">No shift types configured yet.</p>
            )}
          </div>

          {/* Quota Limit Groups Card */}
          <div className={`${activeAdminPage === 'rules' ? '' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
            <h2 className="text-lg font-bold text-slate-800 mb-4">📊 Quota Limit Groups</h2>
            
            <form onSubmit={handleAddLimitGroupSubmit} className="space-y-4 mb-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Group Name (e.g. Leaves)
                  </label>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. Nights"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Default Daily Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newGroupLimit}
                    onChange={(e) => setNewGroupLimit(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 text-xs transition"
              >
                ➕ Add Limit Group
              </button>
            </form>

            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-t border-slate-100 pt-6">
              Active Limit Groups
            </h3>
            
            {limitGroups.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto pr-2">
                {limitGroups.map((lg) => (
                  <div key={lg.ID} className="flex items-center justify-between py-3 text-xs">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 text-sm">{lg.GroupName}</span>
                      <span className="text-[10px] text-slate-500 mt-1 font-semibold">
                        Default Limit: {lg.DefaultLimit} slots/day
                      </span>
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete limit group ${lg.GroupName}? Associated shift types will lose their limits.`)) onDeleteLimitGroup(lg.ID);
                      }}
                      className="text-rose-500 font-bold hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">No limit groups created.</p>
            )}
          </div>
        </div>{/* end right column */}

      </div>

      {/* 📈 Users Monthly Quota Overview */}
      <div className={`${activeAdminPage === 'overview' ? 'mt-8' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 mb-1">📈 Monthly Quota Overview</h2>
            <p className="text-xs text-slate-400">
              Track request limits for all active users for a given month.
            </p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2">
              Select Month
            </label>
            <input
              type="month"
              value={quotaOverviewMonth}
              onChange={(e) => setQuotaOverviewMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white cursor-pointer"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-100">
                <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider pl-2 w-1/3">User Name</th>
                <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-1/3">
                  {userMonthlyUsage.monthLabel} <br/> <span className="opacity-70 text-[10px]">Total Quota ({userMonthlyUsage.limit})</span>
                </th>
                <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-1/3">
                  {userMonthlyUsage.monthLabel} <br/> <span className="opacity-70 text-[10px]">Weekend Quota ({userMonthlyUsage.weekendLimit})</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {Object.keys(userMonthlyUsage.data).sort().map(userName => {
                const stats = userMonthlyUsage.data[userName]?.[userMonthlyUsage.monthKey] || { count: 0, weekendCount: 0 };
                const count = stats.count;
                const weekendCount = stats.weekendCount;
                const limit = userMonthlyUsage.limit;
                const weekendLimit = userMonthlyUsage.weekendLimit;
                
                const isOver = count > limit;
                const isNear = count === limit;
                
                const isWkndOver = weekendCount > weekendLimit;
                const isWkndNear = weekendCount === weekendLimit;

                return (
                  <tr key={userName} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 pl-2 text-sm font-bold text-slate-700">{userName}</td>
                    
                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-lg text-xs font-bold ${
                        isOver ? 'bg-rose-100 text-rose-700' :
                        isNear ? 'bg-amber-100 text-amber-700' :
                        count > 0 ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400'
                      }`}>
                        {count} <span className="opacity-50 ml-0.5">/ {limit}</span>
                      </span>
                    </td>

                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-lg text-xs font-bold ${
                        isWkndOver ? 'bg-rose-100 text-rose-700' :
                        isWkndNear ? 'bg-amber-100 text-amber-700' :
                        weekendCount > 0 ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400'
                      }`}>
                        {weekendCount} <span className="opacity-50 ml-0.5">/ {weekendLimit}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {Object.keys(userMonthlyUsage.data).length === 0 && (
                <tr>
                  <td colSpan="3" className="py-8 text-center text-sm text-slate-400 italic">
                    No active users to track.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🔧 Global Portal Settings */}
      <div className={`${activeAdminPage === 'rules' ? 'mt-8' : 'hidden'} rounded-3xl border border-slate-100 bg-white p-6 shadow-sm`}>
        <h2 className="text-xl font-bold text-slate-800 mb-2">🔧 Global Portal Settings</h2>
        <p className="text-xs text-slate-400 mb-6">
          Configure default values and global policies that apply to all roster portal members.
        </p>

        <form onSubmit={handleSaveSettings} className="max-w-md space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Monthly Request Limit (Total)
              </label>
              <input
                type="number"
                min="1"
                max="99"
                value={monthlyRequestLimitInput}
                onChange={(e) => setMonthlyRequestLimitInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Change the monthly request quota. Set to e.g. 10 to limit each user to 10 shift/swap submissions per month.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Weekend Request Limit
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={monthlyWeekendLimitInput}
                  onChange={(e) => setMonthlyWeekendLimitInput(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Applies to Limit Group
                </label>
                <select
                  value={weekendLimitGroupIdInput}
                  onChange={(e) => setWeekendLimitGroupIdInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                >
                  <option value="ALL">All Requests</option>
                  {limitGroups.map(lg => (
                    <option key={lg.ID} value={lg.ID}>{lg.GroupName}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-slate-400">
                  Limits how many of a user's monthly requests can fall on a weekend (Saturday or Sunday). If a specific limit group is selected, this limit will ONLY restrict requests belonging to that group. Set limit to e.g. 4.
                </p>
              </div>
            </div>
          </div>
          
          <div className="pt-2">
            <button
              type="submit"
              disabled={isUpdatingSettings}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:bg-indigo-300"
            >
              {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>

      {/* 👤 Team Member Details Modal */}
      {isMemberModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm animate-fadeIn flex items-center justify-center">
          <style>{`
            @keyframes scaleUp {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            .animate-scaleUp {
              animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
          `}</style>

          <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl animate-scaleUp transition-all duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <h3 className="text-lg font-bold text-slate-800">
                {memberModalMode === 'add'
                  ? memberModalDirectory === 'ep' ? 'Add New EP' : '👤 Add New Team Member'
                  : memberModalDirectory === 'ep' ? 'Edit EP' : '✏️ Edit Team Member'}
              </h3>
              <button
                type="button"
                onClick={() => setIsMemberModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-semibold leading-none p-1"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveMemberModal} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Display Name (Required)
                </label>
                <input
                  type="text"
                  value={memberModalName}
                  onChange={(e) => setMemberModalName(e.target.value)}
                  placeholder="e.g. Dr. John Doe"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Used for roster assignments and name selection. Must be unique.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Full Name (Optional)
                </label>
                <input
                  type="text"
                  value={memberModalFullName}
                  onChange={(e) => setMemberModalFullName(e.target.value)}
                  placeholder="e.g. Johnathan Doe"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Phone Number (Optional)
                </label>
                <input
                  type="tel"
                  value={memberModalPhone}
                  onChange={(e) => setMemberModalPhone(e.target.value)}
                  placeholder="e.g. +6012-3456789"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              {memberModalDirectory !== 'ep' && (
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <span>
                    <span className="block text-xs font-bold text-slate-700">Active in request list</span>
                    <span className="block text-[10px] text-slate-400">Inactive keeps contacts but hides this member from new requests.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={memberModalActive}
                    onChange={(e) => setMemberModalActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsMemberModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50 active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTeamMembers || isSavingEmergencyPhysicians || !memberModalName.trim()}
                  className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 py-2 text-xs font-bold text-white shadow-md shadow-indigo-100 transition hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50 disabled:shadow-none active:scale-95"
                >
                  {isSavingTeamMembers || isSavingEmergencyPhysicians ? 'Saving...' : memberModalMode === 'add' ? memberModalDirectory === 'ep' ? 'Add EP' : 'Add Member' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
