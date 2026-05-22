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
  fetchMasterRoster,
  fetchShiftBlocks,
  submitActivity,
  deleteActivity,
  updateSetting,
} from './api';
import { normalizeForComparison, toIsoDate, toWeekdayName } from './utils/normalise';

const REFRESH_INTERVAL = 60 * 1000; // 1 minute

function adaptRequestsResponse(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(data?.values)
        ? data.values
        : [];

  return rows.map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const pick = (...keys) => {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(entry, key)) {
            return entry[key];
          }
        }
        return undefined;
      };

      const nameVal = pick('name', 'Name') ?? '';
      const dateVal = pick('date', 'Date') ?? '';
      const dayVal = pick('day', 'Day') ?? '';
      const requestVal = pick('request', 'Request') ?? '';
      const statusVal = pick('status', 'Status') ?? '';
      const commentVal = pick('comment', 'Comment') ?? '';
      const approvalStatusVal = pick('approvalStatus', 'ApprovalStatus') || 'Approved';
      const swapPartnerVal = pick('swapPartner', 'SwapPartner') ?? '';
      const requestTypeVal = pick('requestType', 'RequestType') ?? 'Leave';

      return {
        id: pick('id', 'ID', 'Id'),
        timestamp: pick('timestamp', 'Timestamp'),
        name: nameVal,
        Name: nameVal,
        date: dateVal,
        Date: dateVal,
        day: dayVal,
        Day: dayVal,
        request: requestVal,
        Request: requestVal,
        status: statusVal,
        Status: statusVal,
        comment: commentVal,
        Comment: commentVal,
        ApprovalStatus: approvalStatusVal,
        approvalStatus: approvalStatusVal,
        SwapPartner: swapPartnerVal,
        swapPartner: swapPartnerVal,
        RequestType: requestTypeVal,
        requestType: requestTypeVal,
      };
    }

    return entry;
  });
}

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [requests, setRequests] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_requests');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
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
  const [masterRoster, setMasterRoster] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_masterRoster');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [shiftBlocks, setShiftBlocks] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_shiftBlocks');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [shiftTypes, setShiftTypes] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_shiftTypes');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [limitGroups, setLimitGroups] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_limitGroups');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [activities, setActivities] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_activities');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [settings, setSettings] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_settings');
      return cached ? JSON.parse(cached) : { monthly_request_limit: '10' };
    } catch {
      return { monthly_request_limit: '10' };
    }
  });
  
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_requests');
      return !cached;
    } catch {
      return true;
    }
  });
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
  
  const [teamMembers, setTeamMembers] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_teamMembers');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [teamMembersError, setTeamMembersError] = useState('');
  const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(() => {
    try {
      const cached = localStorage.getItem('resq_cache_teamMembers');
      return !cached;
    } catch {
      return true;
    }
  });

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
          const [teamMembersData, masterRosterData, shiftBlocksData] = await Promise.all([
            fetchTeamMembers().catch(() => []),
            fetchMasterRoster().catch(() => []),
            fetchShiftBlocks().catch(() => []),
          ]);
          rawTeamMembers = teamMembersData;
          rawMasterRoster = masterRosterData;
          rawShiftBlocks = shiftBlocksData;
        } catch (err) {
          console.warn('Fallback individual sheet loading failed:', err);
        }
      } else if (response && typeof response === 'object') {
        // Modern Apps Script format
        rawRequests = response.requests || [];
        rawTeamMembers = response.teamMembers || [];
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
      const names = Array.isArray(rawTeamMembers)
        ? rawTeamMembers
            .map((entry) => (typeof entry === 'string' ? entry : entry?.name ?? ''))
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        : [];
      const deduped = Array.from(new Set(names));
      setTeamMembers(deduped);

      // Parse & set Requests
      const adapted = adaptRequestsResponse(rawRequests);
      setRequests(adapted);

      // Set Master Baseline Roster with validation (ensure items are not request fallbacks)
      const validMasterRoster = Array.isArray(rawMasterRoster)
        ? rawMasterRoster.filter(r => r && (Object.prototype.hasOwnProperty.call(r, 'Shift') || Object.prototype.hasOwnProperty.call(r, 'shift')))
        : [];
      setMasterRoster(validMasterRoster);

      // Set Date caps/limits blocks with validation (ensure items are not request fallbacks)
      const validShiftBlocks = Array.isArray(rawShiftBlocks)
        ? rawShiftBlocks.filter(b => b && (Object.prototype.hasOwnProperty.call(b, 'MaxSlots') || Object.prototype.hasOwnProperty.call(b, 'maxSlots')))
        : [];
      setShiftBlocks(validShiftBlocks);

      // Set Shift Types Configuration
      const validShiftTypes = Array.isArray(rawShiftTypes)
        ? rawShiftTypes.filter(t => t && (Object.prototype.hasOwnProperty.call(t, 'Name') || Object.prototype.hasOwnProperty.call(t, 'name')))
        : [];
      setShiftTypes(validShiftTypes);

      // Set Limit Groups Configuration
      const validLimitGroups = Array.isArray(rawLimitGroups)
        ? rawLimitGroups.filter(g => g && (Object.prototype.hasOwnProperty.call(g, 'GroupName') || Object.prototype.hasOwnProperty.call(g, 'groupName')))
        : [];
      setLimitGroups(validLimitGroups);

      // Parse & set Activity History Configuration
      const validActivities = Array.isArray(rawActivities)
        ? rawActivities.map(act => {
            const pick = (...keys) => {
              for (const key of keys) {
                if (act && Object.prototype.hasOwnProperty.call(act, key)) {
                  return act[key];
                }
              }
              return undefined;
            };
            return {
              ID: String(pick('ID', 'id', 'Id') || ''),
              Timestamp: pick('Timestamp', 'timestamp') || '',
              CustomText: pick('CustomText', 'customText') || '',
              Name: pick('Name', 'name') || '',
              RequestType: pick('RequestType', 'requestType') || '',
              Request: pick('Request', 'request') || '',
              SwapPartner: pick('SwapPartner', 'swapPartner') || '',
              Date: pick('Date', 'date') || '',
              ApprovalStatus: pick('ApprovalStatus', 'approvalStatus') || 'Approved',
              Comment: pick('Comment', 'comment') || ''
            };
          }).filter(act => act.ID && act.ID.trim().toLowerCase() !== 'id' && (act.CustomText || act.Name))
        : [];
      setActivities(validActivities);

      // Cache the loaded data in localStorage for Cache-First rendering
      try {
        localStorage.setItem('resq_cache_teamMembers', JSON.stringify(deduped));
        localStorage.setItem('resq_cache_requests', JSON.stringify(adapted));
        localStorage.setItem('resq_cache_masterRoster', JSON.stringify(validMasterRoster));
        localStorage.setItem('resq_cache_shiftBlocks', JSON.stringify(validShiftBlocks));
        localStorage.setItem('resq_cache_shiftTypes', JSON.stringify(validShiftTypes));
        localStorage.setItem('resq_cache_limitGroups', JSON.stringify(validLimitGroups));
        localStorage.setItem('resq_cache_activities', JSON.stringify(validActivities));
        if (response && typeof response === 'object' && response.settings) {
          localStorage.setItem('resq_cache_settings', JSON.stringify(response.settings));
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
      return [...teamMembers];
    }
    return fallbackNames;
  }, [teamMembers, fallbackNames]);

  // Ensure current verified selector choice is valid after names sync
  useEffect(() => {
    if (isLoading || isLoadingTeamMembers) return;
    if (!selectedName || selectedName?.trim().toLowerCase() === 'admin') return;

    const hasSelected = rosterNames.some(
      (name) => normalizeForComparison(name) === normalizeForComparison(selectedName)
    );

    if (!hasSelected) {
      setSelectedName('');
      localStorage.removeItem('resq_member_name');
    }
  }, [rosterNames, selectedName, isLoading, isLoadingTeamMembers]);

  // Handle Standard Submissions (Optimistic UI & Background save)
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

    // Optimistically update local React state instantly
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

    // Launch save process in background
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

  // Handle Roster Cancellations / Deletions (Optimistic UI & Background delete)
  const handleDeleteRequest = async ({ id, name }) => {
    if (!id) {
      throw new Error('Missing request ID for deletion.');
    }

    const previousRequests = [...requests];

    // Optimistically remove request from local state immediately
    setRequests((prev) => prev.filter((req) => req.id !== id));

    const toastId = addToast(`🔄 Deleting request for ${name || 'member'}...`, 'info', Infinity);

    // Launch delete in background
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

  // Handle Approval Overrides (Admin and Swap Partners) (Optimistic UI & Background update)
  const handleUpdateApproval = async (id, approvalStatus) => {
    const previousRequests = [...requests];

    // Optimistically update approval status locally
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
    const toastId = addToast('🔄 Uploading roster baseline to Google Sheets...', 'info', Infinity);
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
      updateToast(toastId, {
        message: `❌ Upload failed: ${err.message || 'Network error'}`,
        type: 'error',
        duration: 5000,
      });
    }
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
              names={rosterNames}
              requests={requests}
              masterRoster={masterRoster}
              onUploadMasterRoster={handleUploadBaseline}
              onRefresh={loadAllData}
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
