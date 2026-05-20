import { useEffect, useMemo, useState } from 'react';
import UserSection from './components/UserSection';
import Navbar from './components/Navbar';
import NotificationBanner from './components/NotificationBanner';
import HomeDashboard from './components/HomeDashboard';
import RosterPage from './components/RosterPage';
import UpdatesPage from './components/UpdatesPage';
import AdminPanel from './components/AdminPanel';
import AdminPinModal from './components/AdminPinModal';
import OnboardingOverlay from './components/OnboardingOverlay';

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
  submitLimitGroup,
  updateLimitGroup,
  deleteLimitGroup,
  fetchTeamMembers,
  fetchMasterRoster,
  fetchShiftBlocks,
  submitActivity,
  deleteActivity,
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
  const [requests, setRequests] = useState([]);
  const [masterRoster, setMasterRoster] = useState([]);
  const [shiftBlocks, setShiftBlocks] = useState([]);
  const [shiftTypes, setShiftTypes] = useState([]);
  const [limitGroups, setLimitGroups] = useState([]);
  const [activities, setActivities] = useState([]);
  
  const [isLoading, setIsLoading] = useState(true);
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
  
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamMembersError, setTeamMembersError] = useState('');
  const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(true);

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
    if (!selectedName || selectedName?.trim().toLowerCase() === 'admin') return;

    const hasSelected = rosterNames.some(
      (name) => normalizeForComparison(name) === normalizeForComparison(selectedName)
    );

    if (!hasSelected) {
      setSelectedName('');
      localStorage.removeItem('resq_member_name');
    }
  }, [rosterNames, selectedName]);

  // Handle Standard Submissions
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

    if (id) {
      await updateRequest(id, payload);
    } else {
      await submitRequest(payload);
    }

    await loadAllData();
  };

  // Handle Roster Cancellations / Deletions
  const handleDeleteRequest = async ({ id, name }) => {
    if (!id) {
      throw new Error('Missing request ID for deletion.');
    }

    await deleteRequest(id);
    await loadAllData();
  };

  // Handle Approval Overrides (Admin and Swap Partners)
  const handleUpdateApproval = async (id, approvalStatus) => {
    try {
      setRefreshError('');
      await updateRequestApproval(id, approvalStatus);
      await loadAllData();
    } catch (error) {
      setRefreshError(error.message || 'Could not update request approval.');
    }
  };

  // Handle Excel Baseline Uploads
  const handleUploadBaseline = async (rows) => {
    await uploadMasterRoster(rows);
    // Give Google Sheets ~1.5 s to commit the write before reading back
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await loadAllData();
  };

  // Handle Block Consolidation Additions
  const handleAddBlock = async (payload) => {
    try {
      await submitShiftBlock(payload);
      await loadAllData();
    } catch (error) {
      alert(`Failed to apply shift cap: ${error.message}`);
    }
  };

  // Handle Block Consolidation Deletions
  const handleDeleteBlock = async (id) => {
    try {
      await deleteShiftBlock(id);
      await loadAllData();
    } catch (error) {
      alert(`Failed to delete limit cap: ${error.message}`);
    }
  };

  // Handle Shift Types Configuration
  const handleAddShiftType = async (payload) => {
    try {
      await submitShiftType(payload);
      await loadAllData();
    } catch (error) {
      alert(`Failed to add shift type: ${error.message}`);
    }
  };

  const handleUpdateShiftType = async (id, payload) => {
    try {
      await updateShiftType(id, payload);
      await loadAllData();
    } catch (error) {
      alert(`Failed to update shift type: ${error.message}`);
    }
  };

  const handleDeleteShiftType = async (id) => {
    try {
      await deleteShiftType(id);
      await loadAllData();
    } catch (error) {
      alert(`Failed to delete shift type: ${error.message}`);
    }
  };

  // Handle Limit Groups Configuration
  const handleAddLimitGroup = async (payload) => {
    try {
      await submitLimitGroup(payload);
      await loadAllData();
    } catch (error) {
      alert(`Failed to add limit group: ${error.message}`);
    }
  };

  const handleUpdateLimitGroup = async (id, payload) => {
    try {
      await updateLimitGroup(id, payload);
      await loadAllData();
    } catch (error) {
      alert(`Failed to update limit group: ${error.message}`);
    }
  };

  const handleDeleteLimitGroup = async (id) => {
    try {
      await deleteLimitGroup(id);
      await loadAllData();
    } catch (error) {
      alert(`Failed to delete limit group: ${error.message}`);
    }
  };

  const handleAddActivity = async (payload) => {
    try {
      await submitActivity(payload);
      // Give Sheets time to commit the write before reading back
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await loadAllData();
    } catch (error) {
      alert(`Failed to add activity update: ${error.message}`);
    }
  };

  const handleDeleteActivity = async (id) => {
    if (!id) {
      alert('Cannot delete: activity ID is missing.');
      return;
    }
    try {
      await deleteActivity(id);
      // Optimistically remove from UI immediately so it feels instant
      setActivities((prev) => prev.filter((a) => a.ID !== id));
      // Cell updates commit faster than row deletions — 800ms is enough
      await new Promise((resolve) => setTimeout(resolve, 800));
      await loadAllData();
    } catch (error) {
      alert(`Failed to delete activity update: ${error.message}`);
    }
  };

  const activeRequests = useMemo(() => {
    return requests.filter((request) => request.status?.toLowerCase() === 'active');
  }, [requests]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* 🧭 Sticky Glassmorphic Header & Bulletin Wrapper */}
      <div className="sticky top-0 z-40 flex flex-col shadow-md">
        <Navbar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          selectedName={selectedName}
          onSelectName={handleSelectName}
          names={rosterNames}
          syncStatus={isSyncing ? 'loading' : refreshError ? 'error' : 'connected'}
          onRefresh={loadAllData}
        />

        {/* 📣 Marquee Notifications Banner */}
        <NotificationBanner
          requests={requests}
          shiftBlocks={shiftBlocks}
          activities={activities}
          onBannerClick={() => setCurrentPage('updates')}
        />
      </div>

      {/* ⚙️ Page Router Layout */}
      <main className="flex-1 pb-16">
        
        {currentPage === 'dashboard' && (
          <HomeDashboard
            selectedName={selectedName}
            names={rosterNames}
            requests={requests}
            masterRoster={masterRoster}
            shiftBlocks={shiftBlocks}
            onUpdateApproval={handleUpdateApproval}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === 'roster' && (
          <RosterPage
            selectedName={selectedName}
            names={rosterNames}
            requests={requests}
            masterRoster={masterRoster}
            onUploadMasterRoster={handleUploadBaseline}
            onRefresh={loadAllData}
          />
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
            />
          </div>
        )}

        {currentPage === 'updates' && (
          <UpdatesPage
            requests={requests}
            shiftBlocks={shiftBlocks}
            activities={activities}
            selectedName={selectedName}
            onDeleteActivity={handleDeleteActivity}
          />
        )}

        {currentPage === 'admin' && selectedName?.trim().toLowerCase() === 'admin' && (
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
            limitGroups={limitGroups}
            onAddLimitGroup={handleAddLimitGroup}
            onUpdateLimitGroup={handleUpdateLimitGroup}
            onDeleteLimitGroup={handleDeleteLimitGroup}
            activities={activities}
            onAddActivity={handleAddActivity}
            onDeleteActivity={handleDeleteActivity}
          />
        )}

      </main>

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

    </div>
  );
}
