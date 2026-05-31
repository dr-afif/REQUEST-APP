import { useEffect, useMemo, useState } from 'react';
import UserSection from './components/UserSection';
import AppNavigation from './components/AppNavigation';
import NotificationBanner from './components/NotificationBanner';
import HomeDashboard from './components/HomeDashboard';
import RosterPage from './components/RosterPage';
import UpdatesPage from './components/UpdatesPage';
import AdminPanel from './components/AdminPanel';
import AdminPinModal from './components/AdminPinModal';
import OnboardingOverlay from './components/OnboardingOverlay';
import ToastNotification from './components/ToastNotification';
import PwaInstallBanner from './components/PwaInstallBanner';

import {
  deleteRequest,
  submitRequest,
  updateRequest,
  fetchAllData,
  uploadMasterRoster,
  updateRequestApproval,
  submitShiftBlock,
  deleteShiftBlock,
  submitShiftType,
  updateShiftType,
  deleteShiftType,
  reorderShiftTypes,
  submitLimitGroup,
  updateLimitGroup,
  deleteLimitGroup,
  fetchTeamMembers,
  fetchEmergencyPhysicians,
  fetchMasterRoster,
  fetchShiftBlocks,
  submitActivity,
  deleteActivity,
  updateSetting,
  updateTeamMembers,
  updateEmergencyPhysicians,
} from './api';
import {
  adaptRequestsResponse,
  normalizeActivities,
  validateLimitGroups,
  validateMasterRoster,
  validateShiftBlocks,
  validateShiftTypes,
} from './utils/adapters';
import { hasCacheValue, readCache, writeCacheEntries } from './utils/cache';
import { normalizeForComparison, toIsoDate, toWeekdayName } from './utils/normalise';

const REFRESH_INTERVAL = 60 * 1000; // 1 minute

const normalizeDirectoryMembers = (rawMembers) => {
  const members = Array.isArray(rawMembers)
    ? rawMembers
        .map((entry) => {
          if (typeof entry === 'string') {
            return { name: entry.trim(), fullName: '', phone: '', active: true };
          }
          const rawActive = entry?.active ?? entry?.Active;
          return {
            name: String(entry?.name || entry?.MemberName || '').trim(),
            fullName: String(entry?.fullName || entry?.FullName || '').trim(),
            phone: String(entry?.phone || entry?.Phone || '').trim(),
            active: rawActive === undefined || rawActive === null || rawActive === ''
              ? true
              : !['false', 'inactive', 'no', '0'].includes(String(rawActive).trim().toLowerCase()),
          };
        })
        .filter((member) => member.name)
    : [];

  const seen = new Set();
  const dedupedMembers = [];
  for (const member of members) {
    const key = member.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      dedupedMembers.push(member);
    }
  }
  return dedupedMembers;
};

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  // Cache-first state shows last-known data while Apps Script refreshes in the background.
  const [requests, setRequests] = useState(() => adaptRequestsResponse(readCache('resq_cache_requests', [])));
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info', duration = 3000) => {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const updateToast = (id, updates) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };
  const [masterRoster, setMasterRoster] = useState(() => validateMasterRoster(readCache('resq_cache_masterRoster', [])));
  const [shiftBlocks, setShiftBlocks] = useState(() => readCache('resq_cache_shiftBlocks', []));
  const [shiftTypes, setShiftTypes] = useState(() => readCache('resq_cache_shiftTypes', []));
  const [limitGroups, setLimitGroups] = useState(() => readCache('resq_cache_limitGroups', []));
  const [activities, setActivities] = useState(() => readCache('resq_cache_activities', []));
  const [settings, setSettings] = useState(() => readCache('resq_cache_settings', { monthly_request_limit: '10' }));
  
  const [isLoading, setIsLoading] = useState(() => !hasCacheValue('resq_cache_requests'));
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedName, setSelectedName] = useState(() => {
    const stored = localStorage.getItem('resq_member_name') || '';
    if (stored?.trim().toLowerCase() === 'admin') {
      const isVerified = sessionStorage.getItem('resq_admin_verified') === 'true';
      return isVerified ? 'Admin' : '';
    }
    return stored;
  });
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pendingSelectName, setPendingSelectName] = useState('');
  const [refreshError, setRefreshError] = useState('');
  
  const [teamMembers, setTeamMembers] = useState(() => readCache('resq_cache_teamMembers', []));
  const [emergencyPhysicians, setEmergencyPhysicians] = useState(() => readCache('resq_cache_emergencyPhysicians', []));
  const [teamMembersError, setTeamMembersError] = useState('');
  const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(() => !hasCacheValue('resq_cache_teamMembers'));

  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      const isDismissed = localStorage.getItem('resq_pwa_dismissed') === 'true';
      if (!isDismissed) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    window.addEventListener('appinstalled', () => {
      setInstallPrompt(null);
      setShowInstallBanner(false);
      console.log('ED Roster App was installed successfully');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismissPwaBanner = () => {
    localStorage.setItem('resq_pwa_dismissed', 'true');
    setShowInstallBanner(false);
  };

  // Automatic navigation guard for admin page access control
  useEffect(() => {
    if (currentPage === 'admin' && selectedName?.trim().toLowerCase() !== 'admin') {
      setCurrentPage('dashboard');
    }
  }, [currentPage, selectedName]);

  const handleSelectName = (name) => {
    if (name === '') {
      // Logout / Exit
      localStorage.removeItem('resq_member_name');
      sessionStorage.removeItem('resq_admin_verified');
      setSelectedName('');
      setCurrentPage('dashboard');
    } else if (name?.trim().toLowerCase() === 'admin') {
      setPendingSelectName('Admin');
      setIsPinModalOpen(true);
    } else {
      localStorage.setItem('resq_member_name', name);
      setSelectedName(name);
    }
  };

  const handleAdminInit = () => {
    setPendingSelectName('Admin');
    setIsPinModalOpen(true);
  };

  const handlePinSuccess = () => {
    sessionStorage.setItem('resq_admin_verified', 'true');
    localStorage.setItem('resq_member_name', 'Admin');
    setSelectedName('Admin');
    setIsPinModalOpen(false);
    setPendingSelectName('');
  };

  const handlePinClose = () => {
    setIsPinModalOpen(false);
    setPendingSelectName('');
  };

  // 1. Unified Roster Data Synchronization Handler with Resilient Legacy Fallback
  const loadAllData = async () => {
    try {
      setIsSyncing(true);
      setRefreshError('');
      
      const response = await fetchAllData();
      
      let rawRequests = [];
      let rawTeamMembers = [];
      let rawEmergencyPhysicians = [];
      let rawMasterRoster = [];
      let rawShiftBlocks = [];
      let rawShiftTypes = [];
      let rawLimitGroups = [];
      let rawActivities = [];

      if (Array.isArray(response)) {
        // 🚨 Legacy / Un-deployed Apps Script detected! 
        // The endpoint doesn't support 'alldata' yet and defaulted to returning the requests list.
        rawRequests = response;

        // Fallback: Fetch other sheets in parallel
        try {
          const [teamMembersData, emergencyPhysiciansData, masterRosterData, shiftBlocksData] = await Promise.all([
            fetchTeamMembers().catch(() => []),
            fetchEmergencyPhysicians().catch(() => []),
            fetchMasterRoster().catch(() => []),
            fetchShiftBlocks().catch(() => []),
          ]);
          rawTeamMembers = teamMembersData;
          rawEmergencyPhysicians = emergencyPhysiciansData;
          rawMasterRoster = masterRosterData;
          rawShiftBlocks = shiftBlocksData;
        } catch (err) {
          console.warn('Fallback individual sheet loading failed:', err);
        }
      } else if (response && typeof response === 'object') {
        // Modern Apps Script format
        rawRequests = response.requests || [];
        rawTeamMembers = response.teamMembers || [];
        rawEmergencyPhysicians = response.emergencyPhysicians || [];
        rawMasterRoster = response.masterRoster || [];
        rawShiftBlocks = response.shiftBlocks || [];
        rawShiftTypes = response.shiftTypes || [];
        rawLimitGroups = response.limitGroups || [];
        rawActivities = response.activityHistory || response.activities || [];
        if (response.settings) {
          setSettings(response.settings);
        }
      }

      // Parse & set Team Members
      const dedupedMembers = normalizeDirectoryMembers(rawTeamMembers);
      const dedupedEmergencyPhysicians = normalizeDirectoryMembers(rawEmergencyPhysicians);
      setTeamMembers(dedupedMembers);
      setEmergencyPhysicians(dedupedEmergencyPhysicians);

      // Parse & set Requests
      const adapted = adaptRequestsResponse(rawRequests);
      setRequests(adapted);

      // Set Master Baseline Roster with validation (ensure items are not request fallbacks)
      const validMasterRoster = validateMasterRoster(rawMasterRoster);
      setMasterRoster(validMasterRoster);

      // Set Date caps/limits blocks with validation (ensure items are not request fallbacks)
      const validShiftBlocks = validateShiftBlocks(rawShiftBlocks);
      setShiftBlocks(validShiftBlocks);

      // Set Shift Types Configuration
      const validShiftTypes = validateShiftTypes(rawShiftTypes);
      setShiftTypes(validShiftTypes);

      // Set Limit Groups Configuration
      const validLimitGroups = validateLimitGroups(rawLimitGroups);
      setLimitGroups(validLimitGroups);

      // Parse & set Activity History Configuration
      const validActivities = normalizeActivities(rawActivities);
      setActivities(validActivities);

      // Keep cache keys stable; existing sessions depend on them for startup.
      try {
        writeCacheEntries([
          ['resq_cache_teamMembers', dedupedMembers],
          ['resq_cache_emergencyPhysicians', dedupedEmergencyPhysicians],
          ['resq_cache_requests', adapted],
          ['resq_cache_masterRoster', validMasterRoster],
          ['resq_cache_shiftBlocks', validShiftBlocks],
          ['resq_cache_shiftTypes', validShiftTypes],
          ['resq_cache_limitGroups', validLimitGroups],
          ['resq_cache_activities', validActivities],
        ]);
        if (response && typeof response === 'object' && response.settings) {
          writeCacheEntries([['resq_cache_settings', response.settings]]);
        }
      } catch (cacheErr) {
        console.warn('Failed to save data to localStorage cache:', cacheErr);
      }
    } catch (error) {
      setRefreshError(error.message ?? 'Could not synchronize roster data.');
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
      setIsLoadingTeamMembers(false);
    }
  };

  // Synchronize on mount and schedule periodic refreshes
  useEffect(() => {
    let timeoutId;

    const fetchLoop = async () => {
      await loadAllData();
      timeoutId = window.setTimeout(fetchLoop, REFRESH_INTERVAL);
    };

    fetchLoop();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const fallbackNames = useMemo(() => {
    const unique = new Set();
    requests.forEach((request) => {
      if (request.name) {
        unique.add(request.name.trim());
      }
    });
    return Array.from(unique);
  }, [requests]);

  const rosterNames = useMemo(() => {
    if (teamMembers.length) {
      return teamMembers
        .filter(m => typeof m === 'string' || m.active !== false)
        .map(m => typeof m === 'string' ? m : m.name);
    }
    return fallbackNames;
  }, [teamMembers, fallbackNames]);

  const allRosterNames = useMemo(() => {
    if (teamMembers.length) {
      return teamMembers.map(m => typeof m === 'string' ? m : m.name);
    }
    return fallbackNames;
  }, [teamMembers, fallbackNames]);

  // Ensure current verified selector choice is valid after names sync
  useEffect(() => {
    if (isLoading || isLoadingTeamMembers) return;
    if (!selectedName || selectedName?.trim().toLowerCase() === 'admin' || selectedName?.trim().toLowerCase() === 'guest') return;

    const hasSelected = rosterNames.some(
      (name) => normalizeForComparison(name) === normalizeForComparison(selectedName)
    );

    if (!hasSelected) {
      setSelectedName('');
      localStorage.removeItem('resq_member_name');
    }
  }, [rosterNames, selectedName, isLoading, isLoadingTeamMembers]);

  // Optimistic request writes update UI first, then refresh or revert after Apps Script responds.
  const handleSubmitRequest = async ({ name, date, request, id, comment, requestType, swapPartner }) => {
    const isoDate = toIsoDate(date);
    const normalizedDate = isoDate ?? date;
    const sanitizedComment = typeof comment === 'string' ? comment.trim() : '';

    const payload = {
      name,
      date: normalizedDate,
      day: normalizedDate ? toWeekdayName(normalizedDate) : '',
      request,
      comment: sanitizedComment,
      requestType: requestType || 'Leave',
      swapPartner: swapPartner || '',
    };

    const previousRequests = [...requests];
    const tempId = id || `opt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    setRequests((prev) => {
      if (id) {
        return prev.map((req) =>
          req.id === id ? { ...req, ...payload, isOptimistic: true } : req
        );
      } else {
        const newReq = {
          ...payload,
          id: tempId,
          isOptimistic: true,
          status: 'Active',
          approvalStatus: 'Pending',
          timestamp: new Date().toISOString(),
        };
        return [...prev, newReq];
      }
    });

    const actionText = id ? 'Updating' : 'Submitting';
    const toastId = addToast(`🔄 ${actionText} request for ${name}...`, 'info', Infinity);

    (async () => {
      try {
        if (id) {
          await updateRequest(id, payload);
        } else {
          await submitRequest(payload);
        }
        updateToast(toastId, {
          message: `✅ Request saved successfully!`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Background save failed:', err);
        setRequests(previousRequests);
        updateToast(toastId, {
          message: `❌ Save failed: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  // Optimistic request deletes mirror submit behavior: local update first, backend confirmation after.
  const handleDeleteRequest = async ({ id, name }) => {
    if (!id) {
      throw new Error('Missing request ID for deletion.');
    }

    const previousRequests = [...requests];

    setRequests((prev) => prev.filter((req) => req.id !== id));

    const toastId = addToast(`🔄 Deleting request for ${name || 'member'}...`, 'info', Infinity);

    (async () => {
      try {
        await deleteRequest(id);
        updateToast(toastId, {
          message: `✅ Request deleted successfully.`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Background deletion failed:', err);
        setRequests(previousRequests);
        updateToast(toastId, {
          message: `❌ Deletion failed: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  // Approval changes share the same optimistic refresh/revert pattern.
  const handleUpdateApproval = async (id, approvalStatus) => {
    const previousRequests = [...requests];

    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, approvalStatus, isOptimistic: true } : req
      )
    );

    const toastId = addToast(`🔄 Updating approval status...`, 'info', Infinity);

    (async () => {
      try {
        await updateRequestApproval(id, approvalStatus);
        updateToast(toastId, {
          message: `✅ Approval status updated.`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Background approval update failed:', err);
        setRequests(previousRequests);
        updateToast(toastId, {
          message: `❌ Approval update failed: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  // Handle Excel Baseline Uploads
  const handleUploadBaseline = async (rows) => {
    const previousMasterRoster = [...masterRoster];
    
    // Optimistically update masterRoster state immediately
    const validatedRows = rows.map((r) => ({
      Name: r.name,
      name: r.name,
      Date: r.date,
      date: r.date,
      Shift: r.shift,
      shift: r.shift,
    }));
    setMasterRoster(validatedRows);

    const toastId = addToast('🔄 Uploading roster baseline to Google Sheets...', 'info', Infinity);
    
    (async () => {
      try {
        await uploadMasterRoster(rows);
        updateToast(toastId, {
          message: '✅ Roster baseline uploaded successfully!',
          type: 'success',
          duration: 3000,
        });
        // Give Google Sheets ~1.5 s to commit the write before reading back
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await loadAllData();
      } catch (err) {
        console.error('Failed to upload baseline:', err);
        setMasterRoster(previousMasterRoster);
        updateToast(toastId, {
          message: `❌ Upload failed: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  // Handle Block Consolidation Additions
  const handleAddBlock = async (payload) => {
    const previousBlocks = [...shiftBlocks];
    const tempId = `opt_${Date.now()}`;
    const newBlock = {
      ID: tempId,
      id: tempId,
      Date: payload.date,
      ShiftType: payload.shiftType,
      MaxSlots: payload.maxSlots,
      isOptimistic: true
    };
    setShiftBlocks((prev) => [...prev, newBlock]);
    const toastId = addToast('🔄 Applying limit block cap...', 'info', Infinity);
    try {
      await submitShiftBlock(payload);
      updateToast(toastId, {
        message: '✅ Limit block cap applied!',
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftBlocks(previousBlocks);
      updateToast(toastId, {
        message: `❌ Failed to apply limit cap: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  // Handle Block Consolidation Deletions
  const handleDeleteBlock = async (id) => {
    const previousBlocks = [...shiftBlocks];
    setShiftBlocks((prev) => prev.filter(b => b.ID !== id && b.id !== id));
    const toastId = addToast('🔄 Deleting limit block cap...', 'info', Infinity);
    try {
      await deleteShiftBlock(id);
      updateToast(toastId, {
        message: '✅ Limit block cap deleted.',
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftBlocks(previousBlocks);
      updateToast(toastId, {
        message: `❌ Failed to delete limit cap: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  // Handle Shift Types Configuration
  const handleAddShiftType = async (payload) => {
    const previousShiftTypes = [...shiftTypes];
    const tempId = `opt_${Date.now()}`;
    const newShiftType = {
      ID: tempId,
      id: tempId,
      Name: payload.name,
      IsPublic: payload.isPublic,
      GroupID: payload.groupId,
      isOptimistic: true
    };
    setShiftTypes((prev) => [...prev, newShiftType]);
    const toastId = addToast(`🔄 Adding shift type "${payload.name}"...`, 'info', Infinity);
    try {
      await submitShiftType(payload);
      updateToast(toastId, {
        message: `✅ Shift type "${payload.name}" added successfully!`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftTypes(previousShiftTypes);
      updateToast(toastId, {
        message: `❌ Failed to add shift type: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleUpdateShiftType = async (id, payload) => {
    const previousShiftTypes = [...shiftTypes];
    setShiftTypes((prev) =>
      prev.map(s => (s.ID === id || s.id === id)
        ? { ...s, Name: payload.name, IsPublic: payload.isPublic, GroupID: payload.groupId, isOptimistic: true }
        : s
      )
    );
    const toastId = addToast(`🔄 Updating shift type "${payload.name}"...`, 'info', Infinity);
    try {
      await updateShiftType(id, payload);
      updateToast(toastId, {
        message: `✅ Shift type "${payload.name}" updated!`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftTypes(previousShiftTypes);
      updateToast(toastId, {
        message: `❌ Failed to update shift type: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleDeleteShiftType = async (id) => {
    const previousShiftTypes = [...shiftTypes];
    const shiftType = shiftTypes.find(s => s.ID === id || s.id === id);
    const label = shiftType ? shiftType.Name : 'shift type';
    setShiftTypes((prev) => prev.filter(s => s.ID !== id && s.id !== id));
    const toastId = addToast(`🔄 Deleting shift type "${label}"...`, 'info', Infinity);
    try {
      await deleteShiftType(id);
      updateToast(toastId, {
        message: `✅ Shift type "${label}" deleted.`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftTypes(previousShiftTypes);
      updateToast(toastId, {
        message: `❌ Failed to delete shift type: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleReorderShiftTypes = async (ids) => {
    const previousShiftTypes = [...shiftTypes];
    const reordered = ids.map(id => shiftTypes.find(s => s.ID === id || s.id === id)).filter(Boolean);
    setShiftTypes(reordered);
    const toastId = addToast('🔄 Reordering shift types configuration...', 'info', Infinity);
    try {
      await reorderShiftTypes(ids);
      updateToast(toastId, {
        message: '✅ Shift types order updated!',
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setShiftTypes(previousShiftTypes);
      updateToast(toastId, {
        message: `❌ Failed to reorder shift types: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  // Handle Limit Groups Configuration
  const handleAddLimitGroup = async (payload) => {
    const previousLimitGroups = [...limitGroups];
    const tempId = `opt_${Date.now()}`;
    const newGroup = {
      ID: tempId,
      id: tempId,
      GroupName: payload.groupName,
      DefaultLimit: payload.defaultLimit,
      isOptimistic: true
    };
    setLimitGroups((prev) => [...prev, newGroup]);
    const toastId = addToast(`🔄 Adding limit group "${payload.groupName}"...`, 'info', Infinity);
    try {
      await submitLimitGroup(payload);
      updateToast(toastId, {
        message: `✅ Limit group "${payload.groupName}" added!`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setLimitGroups(previousLimitGroups);
      updateToast(toastId, {
        message: `❌ Failed to add limit group: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleUpdateLimitGroup = async (id, payload) => {
    const previousLimitGroups = [...limitGroups];
    setLimitGroups((prev) =>
      prev.map(g => (g.ID === id || g.id === id)
        ? { ...g, GroupName: payload.groupName, DefaultLimit: payload.defaultLimit, isOptimistic: true }
        : g
      )
    );
    const toastId = addToast(`🔄 Updating limit group "${payload.groupName}"...`, 'info', Infinity);
    try {
      await updateLimitGroup(id, payload);
      updateToast(toastId, {
        message: `✅ Limit group "${payload.groupName}" updated!`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setLimitGroups(previousLimitGroups);
      updateToast(toastId, {
        message: `❌ Failed to update limit group: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleDeleteLimitGroup = async (id) => {
    const previousLimitGroups = [...limitGroups];
    const group = limitGroups.find(g => g.ID === id || g.id === id);
    const label = group ? group.GroupName : 'limit group';
    setLimitGroups((prev) => prev.filter(g => g.ID !== id && g.id !== id));
    const toastId = addToast(`🔄 Deleting limit group "${label}"...`, 'info', Infinity);
    try {
      await deleteLimitGroup(id);
      updateToast(toastId, {
        message: `✅ Limit group "${label}" deleted.`,
        type: 'success',
        duration: 3000,
      });
      await loadAllData();
    } catch (error) {
      setLimitGroups(previousLimitGroups);
      updateToast(toastId, {
        message: `❌ Failed to delete limit group: ${error.message}`,
        type: 'error',
        duration: 5000,
      });
    }
  };

  const handleAddActivity = async (payload) => {
    const previousActivities = [...activities];
    const tempId = `opt_${Date.now()}`;
    const newActivity = {
      ...payload,
      ID: tempId,
      Timestamp: new Date().toISOString(),
      isOptimistic: true,
    };

    // Optimistically update state
    setActivities((prev) => [newActivity, ...prev]);
    const toastId = addToast(`🔄 Publishing announcement/update...`, 'info', Infinity);

    (async () => {
      try {
        await submitActivity(payload);
        updateToast(toastId, {
          message: `✅ Announcement published successfully.`,
          type: 'success',
          duration: 3000,
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        await loadAllData();
      } catch (err) {
        console.error('Background activity addition failed:', err);
        setActivities(previousActivities);
        updateToast(toastId, {
          message: `❌ Failed to publish announcement: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  const handleDeleteActivity = async (id) => {
    if (!id) {
      alert('Cannot delete: activity ID is missing.');
      return;
    }
    const previousActivities = [...activities];

    // Optimistically delete from UI
    setActivities((prev) => prev.filter((a) => a.ID !== id));
    const toastId = addToast(`🔄 Deleting announcement/update...`, 'info', Infinity);

    (async () => {
      try {
        await deleteActivity(id);
        updateToast(toastId, {
          message: `✅ Announcement deleted.`,
          type: 'success',
          duration: 3000,
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        await loadAllData();
      } catch (err) {
        console.error('Background activity deletion failed:', err);
        setActivities(previousActivities);
        updateToast(toastId, {
          message: `❌ Deletion failed: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  const handleUpdateSetting = async (key, value) => {
    const previousSettings = { ...settings };
    setSettings((prev) => ({ ...prev, [key]: value }));

    const toastId = addToast(`🔄 Updating system settings...`, 'info', Infinity);

    (async () => {
      try {
        await updateSetting(key, value);
        updateToast(toastId, {
          message: `✅ Settings updated successfully!`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Failed to update setting:', err);
        setSettings(previousSettings);
        updateToast(toastId, {
          message: `❌ Failed to update settings: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  const handleUpdateTeamMembers = async (newNames) => {
    const previousTeamMembers = [...teamMembers];
    setTeamMembers(newNames);

    const toastId = addToast(`🔄 Updating team members list...`, 'info', Infinity);

    (async () => {
      try {
        await updateTeamMembers(newNames);
        updateToast(toastId, {
          message: `✅ Team members list updated successfully!`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Failed to update team members:', err);
        setTeamMembers(previousTeamMembers);
        updateToast(toastId, {
          message: `❌ Failed to update team members: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  const handleUpdateEmergencyPhysicians = async (newNames) => {
    const previousEmergencyPhysicians = [...emergencyPhysicians];
    setEmergencyPhysicians(newNames);

    const toastId = addToast(`🔄 Updating emergency physicians list...`, 'info', Infinity);

    (async () => {
      try {
        await updateEmergencyPhysicians(newNames);
        updateToast(toastId, {
          message: `✅ Emergency physicians list updated successfully!`,
          type: 'success',
          duration: 3000,
        });
        await loadAllData();
      } catch (err) {
        console.error('Failed to update emergency physicians:', err);
        setEmergencyPhysicians(previousEmergencyPhysicians);
        updateToast(toastId, {
          message: `❌ Failed to update emergency physicians: ${err.message || 'Network error'}. Reverted.`,
          type: 'error',
          duration: 5000,
        });
      }
    })();
  };

  const activeRequests = useMemo(() => {
    return requests.filter((request) => request.status?.toLowerCase() === 'active');
  }, [requests]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans">
      
      {/* 🧭 Sticky Glassmorphic Navigation Component */}
      <AppNavigation
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        selectedName={selectedName}
        onSelectName={handleSelectName}
        names={rosterNames}
        syncStatus={isSyncing ? 'loading' : refreshError ? 'error' : 'connected'}
        onRefresh={loadAllData}
      />

      {/* Content wrapper which translates right on desktop */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        
        {/* 📣 Marquee Notifications Banner */}
        <div className="sticky top-14 lg:top-0 z-30 shadow-xs flex flex-col">
          <NotificationBanner
            requests={requests}
            shiftBlocks={shiftBlocks}
            activities={activities}
            onBannerClick={() => setCurrentPage('updates')}
          />
        </div>

        {/* ⚙️ Page Router Layout */}
        <main className="flex-1 pb-24 lg:pb-8">
        
        {currentPage === 'dashboard' && (
          <div className="animate-fadeIn">
            <HomeDashboard
              selectedName={selectedName}
              names={rosterNames}
              requests={requests}
              masterRoster={masterRoster}
              shiftBlocks={shiftBlocks}
              onUpdateApproval={handleUpdateApproval}
              onNavigate={setCurrentPage}
            />
          </div>
        )}

        {currentPage === 'roster' && (
          <div className="animate-fadeIn">
            <RosterPage
              selectedName={selectedName}
              names={allRosterNames}
              requests={requests}
              masterRoster={masterRoster}
              onUploadMasterRoster={handleUploadBaseline}
              onRefresh={loadAllData}
              shiftTypes={shiftTypes}
              teamMembers={teamMembers}
              emergencyPhysicians={emergencyPhysicians}
              onSubmitRequest={handleSubmitRequest}
              onDeleteRequest={handleDeleteRequest}
              settings={settings}
              onUpdateSetting={handleUpdateSetting}
            />
          </div>
        )}

        {currentPage === 'requests' && (
          <div className="mx-auto max-w-6xl px-4 pt-8 md:px-8 animate-fadeIn">
            <UserSection
              requests={activeRequests}
              names={rosterNames}
              namesError={teamMembersError}
              isLoadingNames={isLoadingTeamMembers}
              selectedName={selectedName}
              onSelectName={handleSelectName}
              onSubmitRequest={handleSubmitRequest}
              onDeleteRequest={handleDeleteRequest}
              isLoadingRequests={isLoading}
              shiftBlocks={shiftBlocks}
              masterRoster={masterRoster}
              shiftTypes={shiftTypes}
              limitGroups={limitGroups}
              settings={settings}
            />
          </div>
        )}

        {currentPage === 'updates' && (
          <div className="animate-fadeIn">
            <UpdatesPage
              requests={requests}
              shiftBlocks={shiftBlocks}
              activities={activities}
              selectedName={selectedName}
              onDeleteActivity={handleDeleteActivity}
            />
          </div>
        )}

        {currentPage === 'admin' && selectedName?.trim().toLowerCase() === 'admin' && (
          <div className="animate-fadeIn">
            <AdminPanel
              requests={requests}
              shiftBlocks={shiftBlocks}
              names={rosterNames}
              teamMembers={teamMembers}
              emergencyPhysicians={emergencyPhysicians}
              onUpdateApproval={handleUpdateApproval}
              onAddBlock={handleAddBlock}
              onDeleteBlock={handleDeleteBlock}
              shiftTypes={shiftTypes}
              onAddShiftType={handleAddShiftType}
              onUpdateShiftType={handleUpdateShiftType}
              onDeleteShiftType={handleDeleteShiftType}
              onReorderShiftTypes={handleReorderShiftTypes}
              limitGroups={limitGroups}
              onAddLimitGroup={handleAddLimitGroup}
              onUpdateLimitGroup={handleUpdateLimitGroup}
              onDeleteLimitGroup={handleDeleteLimitGroup}
              activities={activities}
              onAddActivity={handleAddActivity}
              onDeleteActivity={handleDeleteActivity}
              settings={settings}
              onUpdateSetting={handleUpdateSetting}
              onUpdateTeamMembers={handleUpdateTeamMembers}
              onUpdateEmergencyPhysicians={handleUpdateEmergencyPhysicians}
            />
          </div>
        )}

      </main>
      </div>

      {/* Onboarding Screen Dialog Overlay */}
      {selectedName === '' && (
        <OnboardingOverlay
          names={rosterNames}
          onSelect={handleSelectName}
          onAdminInit={handleAdminInit}
          isLoading={isLoadingTeamMembers}
        />
      )}

      {/* Admin security PIN verification dialog */}
      <AdminPinModal
        isOpen={isPinModalOpen}
        onClose={handlePinClose}
        onSuccess={handlePinSuccess}
      />

      {/* PWA Install Banner */}
      {showInstallBanner && (
        <PwaInstallBanner
          installPrompt={installPrompt}
          onDismiss={handleDismissPwaBanner}
        />
      )}

      {/* Toast notifications container */}
      <ToastNotification toasts={toasts} onRemove={removeToast} />

    </div>
  );
}
