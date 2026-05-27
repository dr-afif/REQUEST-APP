import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';
import { openRosterPdfExport } from '../utils/rosterPdfExport';
import { getHolidayName } from '../utils/holidays';

// Helper to parse standby status and extended shift status from a shift name string
const parseShiftValue = (rawVal) => {
  if (!rawVal) return { cleanShift: '', isStandby: false, isExtended: false };
  const str = String(rawVal).trim().toUpperCase();
  const isStandby = str.endsWith('(S)') || str.endsWith('-S') || str.includes('(S)');
  const isExtended = str.endsWith('(X)') || str.endsWith('-X') || str.includes('(X)');
  const cleanShift = str
    .replace(/\(S\)/g, '')
    .replace(/-S/g, '')
    .replace(/\(X\)/g, '')
    .replace(/-X/g, '')
    .trim();
  return { cleanShift, isStandby, isExtended };
};

// Helper to identify night shift variants (NIGHT, N, ON, ON1, ON2)
const isNightShift = (shiftName) => {
  const up = String(shiftName || '').trim().toUpperCase();
  return up === 'NIGHT' || up === 'N' || up.includes('NIGHT') || up === 'ON' || up === 'ON1' || up === 'ON2';
};

// Helper to extract all night shift names from day assignments
const getNightShiftNamesFromGrid = (dayData) => {
  if (!dayData) return '';
  const namesSet = new Set();
  Object.keys(dayData).forEach((key) => {
    if (isNightShift(key)) {
      const valStr = dayData[key];
      if (valStr) {
        valStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean).forEach(n => namesSet.add(n));
      }
    }
  });
  return Array.from(namesSet).join(', ');
};

const splitRosterNames = (value) => String(value || '')
  .split(/[,\n]+/)
  .map((name) => name.trim())
  .filter(Boolean);

// Helper to clean up any duplicate name assignments on the same day when a standard shift (AM, PM, NIGHT) is modified
const cleanDayDataForNameOverlap = (dayData, modifiedShiftCol, newValue) => {
  const nextDayData = { ...dayData };
  nextDayData[modifiedShiftCol] = newValue;
  
  const newNames = newValue
    ? newValue.split(/[\n,]+/).map(n => n.trim()).filter(Boolean)
    : [];
    
  if (newNames.length === 0) return nextDayData;
  
  const normalizedNewNames = newNames.map(n => normalizeForComparison(n));
  
  const removeNamesFromList = (namesStr) => {
    if (!namesStr) return '';
    return namesStr
      .split(/[\n,]+/)
      .map(n => n.trim())
      .filter(n => !normalizedNewNames.includes(normalizeForComparison(n)) && n !== '')
      .join(', ');
  };
  
  // Remove these names from all OTHER shift columns
  Object.keys(nextDayData).forEach((shiftKey) => {
    if (shiftKey !== modifiedShiftCol) {
      nextDayData[shiftKey] = removeNamesFromList(nextDayData[shiftKey]);
    }
  });
  
  return nextDayData;
};

export default function RosterPage({
  selectedName,
  names = [],
  masterRoster = [],
  onUploadMasterRoster,
  onRefresh,
  shiftTypes = [],
  requests = [],
  teamMembers = [],
  emergencyPhysicians = [],
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isStandbyEditMode, setIsStandbyEditMode] = useState(false);
  const [isExtendedEditMode, setIsExtendedEditMode] = useState(false);
  const [editedGrid, setEditedGrid] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar' or 'table'
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    mainTitle: 'ED HSAAS',
    rosterType: 'MO & EP ROSTER',
    monthYear: '',
    version: 'v1.0',
    notes: '',
  });

  // Thresholds for shift tally alerts (persisted in localStorage)
  const [tallyThresholds, setTallyThresholds] = useState(() => {
    try {
      const saved = localStorage.getItem('rosterTallyThresholds');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    const defaultThresholds = {
      amMin: 1,
      pmMin: 1,
      nightMin: 1,
      nightMax: 2,
      totalLeaveMax: 4,
    };
    try {
      const saved = localStorage.getItem('rosterTallyThresholds');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.totalLeaveMax === 3) {
          parsed.totalLeaveMax = 4;
        }
        return { ...defaultThresholds, ...parsed };
      }
    } catch (e) {
      console.error(e);
    }
    return defaultThresholds;
  });

  useEffect(() => {
    localStorage.setItem('rosterTallyThresholds', JSON.stringify(tallyThresholds));
  }, [tallyThresholds]);

  // 1. Set the initial roster month to the current month (YYYY-MM)
  const [rosterMonth, setRosterMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  });

  const todayStr = useMemo(() => toIsoDate(new Date()), []);

  // Check if the current rosterMonth is strictly in the future relative to the system today
  const isUpcomingMonth = useMemo(() => {
    const currentMonthStr = todayStr.substring(0, 7); // "YYYY-MM"
    return rosterMonth > currentMonthStr;
  }, [rosterMonth, todayStr]);

  // Group active requests for the selected month by doctor and date
  const requestsRosterMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(requests) || requests.length === 0) return map;
    
    requests.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const status = String(r.Status || r.status || '').toLowerCase();
      if (status !== 'active') return;
      
      const appStatus = r.ApprovalStatus || r.approvalStatus || '';
      // Only consider Approved or Pending Admin requests for upcoming roster pre-population
      if (appStatus !== 'Approved' && appStatus !== 'Pending Admin') return;
      
      const rawDate = r.Date || r.date;
      const dateStr = toIsoDate(rawDate);
      if (!dateStr) return;
      
      // Filter by the selected month
      if (!dateStr.startsWith(rosterMonth)) return;
      
      const nameRaw = r.Name || r.name;
      if (!nameRaw) return;
      const nameKey = normalizeForComparison(nameRaw);
      
      if (!map.has(nameKey)) {
        map.set(nameKey, new Map());
      }
      
      const requestedShift = String(r.Request || r.request || '').trim().toUpperCase();
      map.get(nameKey).set(dateStr, {
        shift: requestedShift,
        type: r.RequestType || r.requestType || 'Leave',
        approvalStatus: appStatus,
        comment: String(r.Comment || r.comment || '').trim(),
      });
    });
    return map;
  }, [requests, rosterMonth]);

  // 1.0 Get configured shift names from shiftTypes (excluding group formatting where needed)
  const dropdownShifts = useMemo(() => {
    if (shiftTypes && shiftTypes.length > 0) {
      return shiftTypes.filter(s => s && s.Name).map(s => String(s.Name).toUpperCase());
    }
    return ['AM', 'PM', 'NIGHT', 'OFF', 'AL', 'MC', 'HKA', 'GHKA', 'COURSE', 'EL'];
  }, [shiftTypes]);

  // 1.0.1 Helper to return CSS class names based on shift type value
  const getShiftBadgeClass = (val, isRequested = false) => {
    if (!val) return 'bg-slate-50 text-slate-400 border-slate-200';
    const { cleanShift } = parseShiftValue(val);
    const token = cleanShift.toLowerCase();
    
    if (token === 'total leave') return 'bg-indigo-50 text-indigo-900 border-indigo-200 font-extrabold';
    
    // am : green
    if (token === 'am') {
      return isRequested
        ? 'bg-green-600 text-white border-green-700 font-bold'
        : 'bg-green-50 text-green-800 border-green-500';
    }
    
    // pm : yellow
    if (token === 'pm') {
      return isRequested
        ? 'bg-amber-500 text-white border-amber-600 font-bold'
        : 'bg-amber-50 text-amber-800 border-amber-400';
    }
    
    // night (on/on1/on2) : red
    if (token === 'night' || token === 'n' || token === 'on' || token === 'on1' || token === 'on2' || token.includes('night')) {
      return isRequested
        ? 'bg-red-600 text-white border-red-700 font-bold'
        : 'bg-red-50 text-red-800 border-red-500';
    }
    
    // course : orange
    if (token.includes('course')) {
      return isRequested
        ? 'bg-orange-600 text-white border-orange-700 font-bold'
        : 'bg-orange-50 text-orange-800 border-orange-400';
    }
    
    // off : blue
    if (token === 'off') {
      return isRequested
        ? 'bg-blue-600 text-white border-blue-700 font-bold'
        : 'bg-blue-50 text-blue-800 border-blue-400';
    }
    
    // others : grey (AL/ hka/ ghka/ mc/ el/ goff etc)
    return isRequested
      ? 'bg-slate-600 text-white border-slate-700 font-bold'
      : 'bg-slate-50 text-slate-700 border-slate-300';
  };

  // 1.1 Group masterRoster by Name and Date for Table View (allowing all shift types)
  const doctorRosterMap = useMemo(() => {
    const map = new Map();
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = row.Name || row.name;
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const nameKey = normalizeForComparison(nameRaw);
      const shiftRaw = String(shiftVal).trim().toUpperCase();

      if (!map.has(nameKey)) {
        map.set(nameKey, new Map());
      }
      map.get(nameKey).set(dateStr, shiftRaw);
    });
    return map;
  }, [masterRoster]);


  const handlePrevMonth = () => {
    setRosterMonth((prev) => {
      let [year, month] = prev.split('-').map(Number);
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      return `${year}-${String(month).padStart(2, '0')}`;
    });
  };

  const handleNextMonth = () => {
    setRosterMonth((prev) => {
      let [year, month] = prev.split('-').map(Number);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      return `${year}-${String(month).padStart(2, '0')}`;
    });
  };

  const handleCurrentMonth = () => {
    const d = new Date();
    setRosterMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // 2. Generate month name in uppercase (e.g., "MAY 2026")
  const monthLabel = useMemo(() => {
    const [year, month] = rosterMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  }, [rosterMonth]);

  useEffect(() => {
    setExportSettings((prev) => ({ ...prev, monthYear: prev.monthYear || monthLabel }));
  }, [monthLabel]);

  // 3. Generate all calendar days of the detected roster month
  const daysInMonthList = useMemo(() => {
    const [year, month] = rosterMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const list = [];
    while (date.getMonth() === month - 1) {
      const dayNum = date.getDate();
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      const fullDateStr = `${yyyy}-${mm}-${dd}`;
      
      list.push({ dayNum, dayName, dateStr: fullDateStr });
      date.setDate(date.getDate() + 1);
    }
    return list;
  }, [rosterMonth]);

  // 4. Group baseline masterRoster by Date and Shift (AM, PM, NIGHT)
  const rosterGrid = useMemo(() => {
    const grid = {};
    
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = row.Name || row.name;
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const name = String(nameRaw).trim();
      const shiftRaw = String(shiftVal).trim().toUpperCase();
      
      let shiftCol = '';
      if (shiftRaw === 'AM' || shiftRaw.includes('AM')) shiftCol = 'AM';
      else if (shiftRaw === 'PM' || shiftRaw.includes('PM')) shiftCol = 'PM';
      else if (isNightShift(shiftRaw)) shiftCol = 'NIGHT';
      else return;
      
      if (!grid[dateStr]) grid[dateStr] = { AM: [], PM: [], NIGHT: [] };
      if (!grid[dateStr][shiftCol].includes(name)) {
        grid[dateStr][shiftCol].push(name);
      }
    });

    // For upcoming months, if a doctor has an active request for AM, PM, or NIGHT, and is not in masterRoster, auto-populate
    if (isUpcomingMonth && requestsRosterMap) {
      const assignedOnDate = {}; // dateStr -> set of nameKeys
      masterRoster.forEach((row) => {
        const rawDate = row.Date || row.date;
        const dateStr = toIsoDate(rawDate);
        const nameRaw = row.Name || row.name;
        if (dateStr && nameRaw) {
          if (!assignedOnDate[dateStr]) assignedOnDate[dateStr] = new Set();
          assignedOnDate[dateStr].add(normalizeForComparison(nameRaw));
        }
      });

      requestsRosterMap.forEach((dateMap, nameKey) => {
        const docName = names.find(n => normalizeForComparison(n) === nameKey) || nameKey;
        
        dateMap.forEach((reqData, dateStr) => {
          const shiftRaw = String(reqData.shift || '');
          let shiftCol = '';
          if (shiftRaw === 'AM' || shiftRaw.includes('AM')) shiftCol = 'AM';
          else if (shiftRaw === 'PM' || shiftRaw.includes('PM')) shiftCol = 'PM';
          else if (isNightShift(shiftRaw)) shiftCol = 'NIGHT';
          
          if (shiftCol) {
            const isAssigned = assignedOnDate[dateStr]?.has(nameKey);
            if (!isAssigned) {
              if (!grid[dateStr]) grid[dateStr] = { AM: [], PM: [], NIGHT: [] };
              if (!grid[dateStr][shiftCol].includes(docName)) {
                grid[dateStr][shiftCol].push(docName);
              }
            }
          }
        });
      });
    }

    return grid;
  }, [masterRoster, isUpcomingMonth, requestsRosterMap, names]);

  const getEpAssignmentText = (dateStr, epKey) => {
    if (isEditMode) {
      return editedGrid[dateStr]?.[epKey] ?? '';
    }

    return masterRoster
      .filter((row) => {
        const date = toIsoDate(row.Date || row.date);
        const shift = String(row.Shift || row.shift || '').trim().toUpperCase();
        return date === dateStr && shift === epKey;
      })
      .map((row) => String(row.Name || row.name || '').trim())
      .filter(Boolean)
      .join(', ');
  };

  const exportRows = useMemo(() => {
    return daysInMonthList.map(({ dayNum, dayName, dateStr }) => {
      const dayAssignments = rosterGrid[dateStr] || { AM: [], PM: [], NIGHT: [] };
      return {
        date: dayNum,
        day: dayName,
        moAm: isEditMode ? (editedGrid[dateStr]?.AM ?? '') : (dayAssignments.AM || []).join(', '),
        moPm: isEditMode ? (editedGrid[dateStr]?.PM ?? '') : (dayAssignments.PM || []).join(', '),
        moNight: isEditMode ? getNightShiftNamesFromGrid(editedGrid[dateStr]) : (dayAssignments.NIGHT || []).join(', '),
        epAm: getEpAssignmentText(dateStr, 'EP_OFFICE_HOUR'),
        epOncall: getEpAssignmentText(dateStr, 'EP_ONCALL'),
      };
    });
  }, [daysInMonthList, rosterGrid, isEditMode, editedGrid, masterRoster]);

  const exportContacts = useMemo(() => {
    const buildDirectoryLookup = (members) => {
      const contactLookup = new Map();
      const memberOrder = new Map();
      members.forEach((member, index) => {
        const name = typeof member === 'string' ? member : member?.name;
        if (!name) return;
        const key = normalizeForComparison(name);
        memberOrder.set(key, index);
        contactLookup.set(key, {
          name,
          fullName: typeof member === 'string' ? '' : member?.fullName || '',
          phone: typeof member === 'string' ? '' : member?.phone || '',
        });
      });
      return { contactLookup, memberOrder };
    };

    const teamDirectory = buildDirectoryLookup(teamMembers);
    const epDirectory = emergencyPhysicians.length
      ? buildDirectoryLookup(emergencyPhysicians)
      : teamDirectory;

    const buildContacts = (values, directory) => {
      const { contactLookup, memberOrder } = directory;
      const seen = new Set();
      return values
        .flatMap(splitRosterNames)
        .filter((name) => {
          const key = normalizeForComparison(name);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((name) => contactLookup.get(normalizeForComparison(name)) || { name, fullName: '', phone: '' })
        .sort((a, b) => {
          const aOrder = memberOrder.get(normalizeForComparison(a.name)) ?? Number.MAX_SAFE_INTEGER;
          const bOrder = memberOrder.get(normalizeForComparison(b.name)) ?? Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder || a.name.localeCompare(b.name);
        });
    };

    return {
      mo: buildContacts(exportRows.flatMap((row) => [row.moAm, row.moPm, row.moNight]), teamDirectory),
      ep: buildContacts(exportRows.flatMap((row) => [row.epAm, row.epOncall]), epDirectory),
    };
  }, [exportRows, teamMembers, emergencyPhysicians]);

  const isMatch = (name) => {
    if (!searchQuery) return false;
    return normalizeForComparison(name).includes(normalizeForComparison(searchQuery));
  };

  // --- SPREADSHEET ENGINE ---

  const initializeEditedGrid = () => {
    const cloned = {};
    
    // Populate from masterRoster directly to include all shift types (AM, PM, NIGHT, OFF, AL, MC, etc.)
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = row.Name || row.name;
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const name = String(nameRaw).trim();
      const shiftRaw = String(shiftVal).trim().toUpperCase();

      if (!cloned[dateStr]) {
        cloned[dateStr] = {};
      }
      if (!cloned[dateStr][shiftRaw]) {
        cloned[dateStr][shiftRaw] = [];
      }
      if (!cloned[dateStr][shiftRaw].includes(name)) {
        cloned[dateStr][shiftRaw].push(name);
      }
    });

    // Convert arrays back to comma-separated strings
    Object.keys(cloned).forEach((dateStr) => {
      Object.keys(cloned[dateStr]).forEach((shift) => {
        cloned[dateStr][shift] = cloned[dateStr][shift].join(', ');
      });
    });

    // If upcoming month, pre-populate empty roster slots with active requests
    if (isUpcomingMonth) {
      names.forEach((docName) => {
        const docKey = normalizeForComparison(docName);
        const docRequests = requestsRosterMap.get(docKey);
        if (docRequests) {
          daysInMonthList.forEach(({ dateStr }) => {
            const reqData = docRequests.get(dateStr);
            if (reqData && reqData.shift) {
              // Check if this doctor is already assigned in cloned on this day
              const hasRosterShift = Object.keys(cloned[dateStr] || {}).some((shiftKey) => {
                const valStr = cloned[dateStr]?.[shiftKey] || '';
                return valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim())).includes(docKey);
              });

              if (!hasRosterShift) {
                if (!cloned[dateStr]) cloned[dateStr] = {};
                const reqShift = reqData.shift;
                const currentListStr = cloned[dateStr][reqShift] || '';
                const currentList = currentListStr ? currentListStr.split(/[\n,]+/).map(n => n.trim()) : [];
                if (!currentList.includes(docName.trim())) {
                  currentList.push(docName.trim());
                }
                cloned[dateStr][reqShift] = currentList.join(', ');
              }
            }
          });
        }
      });
    }

    // Ensure AM, PM, NIGHT and EP columns are defined for all dates of the month in editedGrid
    daysInMonthList.forEach(({ dateStr }) => {
      if (!cloned[dateStr]) cloned[dateStr] = {};
      if (!cloned[dateStr].AM) cloned[dateStr].AM = '';
      if (!cloned[dateStr].PM) cloned[dateStr].PM = '';
      if (!cloned[dateStr].NIGHT) cloned[dateStr].NIGHT = '';
      if (cloned[dateStr].EP_OFFICE_HOUR === undefined) cloned[dateStr].EP_OFFICE_HOUR = '';
      if (cloned[dateStr].EP_ONCALL === undefined) cloned[dateStr].EP_ONCALL = '';
    });

    return cloned;
  };

  const toggleEditMode = () => {
    if (isEditMode || isStandbyEditMode || isExtendedEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsEditMode(true);
    }
  };

  const toggleStandbyEditMode = () => {
    if (isEditMode || isStandbyEditMode || isExtendedEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsStandbyEditMode(true);
      setActiveTab('table');
    }
  };

  const toggleExtendedEditMode = () => {
    if (isEditMode || isStandbyEditMode || isExtendedEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsExtendedEditMode(true);
      setActiveTab('table');
    }
  };

  const handleToggleStandby = (dateStr, doctorName) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || {};
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // Find the current shift assigned to the doctor
      let currentShiftKey = '';
      Object.keys(dayData).forEach((shiftKey) => {
        const valStr = dayData[shiftKey] || '';
        const namesInShift = valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim()));
        if (namesInShift.includes(normalizedName)) {
          currentShiftKey = shiftKey;
        }
      });

      if (!currentShiftKey) return prev; // No shift to attach standby to

      const { cleanShift, isStandby, isExtended } = parseShiftValue(currentShiftKey);
      
      // Determine the new shift key
      const nextStandby = !isStandby;
      let newShiftKey = cleanShift;
      if (nextStandby) newShiftKey += ' (S)';
      if (isExtended) newShiftKey += ' (X)';

      const nextDayData = { ...dayData };
      // Remove from old shift
      nextDayData[currentShiftKey] = removeNameFromList(nextDayData[currentShiftKey]);
      // Add to new shift
      nextDayData[newShiftKey] = addNameToList(nextDayData[newShiftKey] || '');

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const handleToggleExtended = (dateStr, doctorName) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || {};
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // Find the current shift assigned to the doctor
      let currentShiftKey = '';
      Object.keys(dayData).forEach((shiftKey) => {
        const valStr = dayData[shiftKey] || '';
        const namesInShift = valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim()));
        if (namesInShift.includes(normalizedName)) {
          currentShiftKey = shiftKey;
        }
      });

      if (!currentShiftKey) return prev; // No shift to attach extended status to

      const { cleanShift, isStandby, isExtended } = parseShiftValue(currentShiftKey);
      
      // Determine the new shift key
      const nextExtended = !isExtended;
      let newShiftKey = cleanShift;
      if (isStandby) newShiftKey += ' (S)';
      if (nextExtended) newShiftKey += ' (X)';

      const nextDayData = { ...dayData };
      // Remove from old shift
      nextDayData[currentShiftKey] = removeNameFromList(nextDayData[currentShiftKey]);
      // Add to new shift
      nextDayData[newShiftKey] = addNameToList(nextDayData[newShiftKey] || '');

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const handleCellChange = (dateStr, shiftCol, value) => {
    setEditedGrid(prev => {
      const dayData = prev[dateStr] || { AM: '', PM: '', NIGHT: '' };
      
      let cleanedDayData = { ...dayData };
      if (shiftCol === 'NIGHT') {
        Object.keys(cleanedDayData).forEach((key) => {
          if (isNightShift(key) && key !== 'NIGHT') {
            cleanedDayData[key] = '';
          }
        });
      }
      
      const nextDayData = cleanDayDataForNameOverlap(cleanedDayData, shiftCol, value);
      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  // 1.2 Get editing shift for doctor-date cell in Table View
  const getEditingShift = (dateStr, doctorName) => {
    const dayData = editedGrid[dateStr];
    if (!dayData) return '';
    
    const normalizedName = normalizeForComparison(doctorName);
    
    const checkNameInList = (namesStr) => {
      if (!namesStr) return false;
      return namesStr.split(/[\n,]+/).some(n => normalizeForComparison(n) === normalizedName);
    };

    // Find which key in dayData contains the doctorName
    const assignedShift = Object.keys(dayData).find((shiftKey) => checkNameInList(dayData[shiftKey]));
    return assignedShift || '';
  };

  // 1.3 Handle Table View dropdown select shifts change
  const handleTableEditCellChange = (dateStr, doctorName, newShift) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || { AM: '', PM: '', NIGHT: '' };
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // 1. Remove doctorName from ALL keys (shifts) in dayData
      const nextDayData = {};
      Object.keys(dayData).forEach((shiftKey) => {
        nextDayData[shiftKey] = removeNameFromList(dayData[shiftKey]);
      });

      // 2. Add to new shift if newShift is not empty
      if (newShift) {
        nextDayData[newShift] = addNameToList(nextDayData[newShift] || '');
      }

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const rosterScrollRef = useRef(null);
  const tallyScrollRef = useRef(null);

  useEffect(() => {
    const rosterDiv = rosterScrollRef.current;
    const tallyDiv = tallyScrollRef.current;
    if (!rosterDiv || !tallyDiv) return;

    let isSyncingRoster = false;
    let isSyncingTally = false;

    const handleRosterScroll = () => {
      if (isSyncingTally) {
        isSyncingTally = false;
        return;
      }
      isSyncingRoster = true;
      tallyDiv.scrollLeft = rosterDiv.scrollLeft;
    };

    const handleTallyScroll = () => {
      if (isSyncingRoster) {
        isSyncingRoster = false;
        return;
      }
      isSyncingTally = true;
      rosterDiv.scrollLeft = tallyDiv.scrollLeft;
    };

    rosterDiv.addEventListener('scroll', handleRosterScroll, { passive: true });
    tallyDiv.addEventListener('scroll', handleTallyScroll, { passive: true });

    return () => {
      rosterDiv.removeEventListener('scroll', handleRosterScroll);
      tallyDiv.removeEventListener('scroll', handleTallyScroll);
    };
  }, [activeTab]);

  // 📏 Synchronize column widths between Roster spreadsheet and Shift Distribution Tally
  useEffect(() => {
    if (activeTab !== 'table') return;

    const rosterDiv = rosterScrollRef.current;
    if (!rosterDiv) return;

    const rosterTable = rosterDiv.querySelector('table');
    if (!rosterTable) return;

    const syncWidths = () => {
      const tallyDiv = tallyScrollRef.current;
      if (!tallyDiv) return;

      const rosterHeaders = rosterTable.querySelectorAll('thead th');
      const tallyHeaders = tallyDiv.querySelectorAll('thead th');

      const minLength = Math.min(rosterHeaders.length, tallyHeaders.length);
      for (let i = 0; i < minLength; i++) {
        const rosterWidth = rosterHeaders[i].getBoundingClientRect().width;
        tallyHeaders[i].style.width = `${rosterWidth}px`;
        tallyHeaders[i].style.minWidth = `${rosterWidth}px`;
        tallyHeaders[i].style.maxWidth = `${rosterWidth}px`;
      }
    };

    const observer = new ResizeObserver(() => {
      syncWidths();
    });

    observer.observe(rosterTable);

    // Initial sync and a small delay sync to catch any rendering lag or font load shifts
    syncWidths();
    const timer = setTimeout(syncWidths, 100);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [activeTab, masterRoster, editedGrid, isEditMode, isStandbyEditMode, isExtendedEditMode, names, teamMembers]);

  const tallyData = useMemo(() => {
    const dateMap = new Map();
    const inactiveNames = new Set(
      teamMembers
        .filter(m => typeof m === 'object' && m.active === false)
        .map(m => normalizeForComparison(m.name))
    );
    
    // Get all standard/configured shift types, normalized (avoiding duplicates like ON/ON1/ON2/N which are grouped under NIGHT)
    const baseShifts = new Set(['AM', 'PM', 'NIGHT']);
    dropdownShifts.forEach(s => {
      const up = s.trim().toUpperCase();
      if (up === 'ON' || up === 'ON1' || up === 'ON2' || up === 'N') {
        return;
      }
      baseShifts.add(up);
    });

    const activeShiftTypes = new Set(baseShifts);
    
    daysInMonthList.forEach((day) => {
      const dayTally = new Map();
      
      // Initialize all base shift types to 0
      baseShifts.forEach(shiftType => {
        dayTally.set(shiftType, 0);
      });
      
      dateMap.set(day.dateStr, dayTally);

      names.forEach((name) => {
        let val = '';
        if (isEditMode) {
          val = getEditingShift(day.dateStr, name);
        } else {
          const nameKey = normalizeForComparison(name);
          val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
          if (!val && isUpcomingMonth) {
            const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
            if (reqData) {
              val = reqData.shift;
            }
          }
        }

        if (val) {
          const { cleanShift } = parseShiftValue(val);
          let shiftType = cleanShift.toUpperCase();
          if (shiftType === 'ON' || shiftType === 'ON1' || shiftType === 'ON2' || shiftType === 'N') {
            shiftType = 'NIGHT';
          }

          // If inactive, only count active shifts (AM, PM, NIGHT, PN, OH), ignore leave shifts (AL, OFF, etc.)
          const nameKey = normalizeForComparison(name);
          const isInactive = inactiveNames.has(nameKey);
          const isActiveShift = ['AM', 'PM', 'NIGHT', 'PN', 'OH'].includes(shiftType);
          if (isInactive && !isActiveShift) {
            return;
          }

          dayTally.set(shiftType, (dayTally.get(shiftType) || 0) + 1);
          activeShiftTypes.add(shiftType);
        }
      });

      // Calculate "TOTAL LEAVE" for this day: sum of all non-AM/PM/NIGHT/PN/OH shift types
      let totalLeaveCount = 0;
      dayTally.forEach((count, sType) => {
        if (sType !== 'AM' && sType !== 'PM' && sType !== 'NIGHT' && sType !== 'PN' && sType !== 'OH') {
          totalLeaveCount += count;
        }
      });
      dayTally.set('TOTAL LEAVE', totalLeaveCount);
    });

    const getShiftIndex = (shiftType) => {
      let lookupType = shiftType;
      if (lookupType === 'NIGHT') {
        const nightIndex = dropdownShifts.findIndex(s => {
          const up = s.trim().toUpperCase();
          return up === 'NIGHT' || up === 'N' || up === 'ON' || up === 'ON1' || up === 'ON2';
        });
        if (nightIndex !== -1) return nightIndex;
      }
      return dropdownShifts.findIndex(s => s.trim().toUpperCase() === lookupType);
    };

    const sortedShifts = Array.from(activeShiftTypes).sort((a, b) => {
      const idxA = getShiftIndex(a);
      const idxB = getShiftIndex(b);
      const valA = idxA !== -1 ? idxA : 999;
      const valB = idxB !== -1 ? idxB : 999;
      if (valA !== valB) return valA - valB;
      return a.localeCompare(b);
    });

    sortedShifts.push('TOTAL LEAVE');

    return {
      tallyMap: dateMap,
      shifts: sortedShifts,
    };
  }, [daysInMonthList, names, isEditMode, editedGrid, doctorRosterMap, requestsRosterMap, isUpcomingMonth, dropdownShifts, teamMembers]);

  // Per-member shift tally for the current month
  // Tracks: AM, PM, NIGHT (on/on1/on2), PN, GHKA, and Total Leaves (all except AM/PM/NIGHT/PN/OH)
  const memberTallyData = useMemo(() => {
    // Columns we always show in order
    const TRACKED = ['AM', 'PM', 'NIGHT', 'PN', 'GHKA'];
    const LEAVE_EXCLUDES = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);

    // Map: nameKey -> { AM, PM, NIGHT, PN, GHKA, TOTAL_LEAVE }
    const memberMap = new Map();

    names.forEach((name) => {
      const nameKey = normalizeForComparison(name);
      memberMap.set(nameKey, { name, AM: 0, PM: 0, NIGHT: 0, PN: 0, GHKA: 0, TOTAL_LEAVE: 0 });
    });

    daysInMonthList.forEach((day) => {
      names.forEach((name) => {
        const nameKey = normalizeForComparison(name);
        let val = '';
        if (isEditMode) {
          val = getEditingShift(day.dateStr, name);
        } else {
          val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
          if (!val && isUpcomingMonth) {
            const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
            if (reqData) val = reqData.shift;
          }
        }

        if (!val) return;
        const { cleanShift } = parseShiftValue(val);
        let shiftType = cleanShift.toUpperCase();
        // Normalise night variants
        if (shiftType === 'ON' || shiftType === 'ON1' || shiftType === 'ON2' || shiftType === 'N') {
          shiftType = 'NIGHT';
        }

        const entry = memberMap.get(nameKey);
        if (!entry) return;

        if (TRACKED.includes(shiftType)) {
          entry[shiftType] += 1;
        }
        // Total Leaves: everything except AM/PM/NIGHT/PN/OH
        if (!LEAVE_EXCLUDES.has(shiftType)) {
          entry.TOTAL_LEAVE += 1;
        }
      });
    });

    return Array.from(memberMap.values());
  }, [daysInMonthList, names, isEditMode, editedGrid, doctorRosterMap, requestsRosterMap, isUpcomingMonth]);

  const handleKeyDown = (e, dateStr, shiftCol, dayIndex, shiftIndex) => {
    const key = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
      if (key === 'Enter' && (e.altKey || e.shiftKey)) {
        return; // Allow native textarea newline for Alt+Enter
      }
      
      let nextDayIndex = dayIndex;
      let nextShiftIndex = shiftIndex;

      if (key === 'ArrowUp') nextDayIndex -= 1;
      if (key === 'ArrowDown' || key === 'Enter') nextDayIndex += 1;
      if (key === 'ArrowLeft' && shiftIndex > 0) nextShiftIndex -= 1;
      if (key === 'ArrowRight' && shiftIndex < 4) nextShiftIndex += 1;

      if (nextDayIndex >= 0 && nextDayIndex < daysInMonthList.length) {
        e.preventDefault();
        const nextId = `cell-${nextDayIndex}-${nextShiftIndex}`;
        document.getElementById(nextId)?.focus();
      }
    }
  };

  const handlePaste = (e, startDayIndex, startShiftIndex) => {
    e.preventDefault();
    const pasteText = e.clipboardData.getData('text');
    if (!pasteText) return;

    // Excel wraps cells with Alt+Enter newlines in double quotes
    let inQuotes = false;
    let normalizedText = '';
    for (let i = 0; i < pasteText.length; i++) {
      const char = pasteText[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        normalizedText += char;
      } else if (inQuotes && char === '\r') {
        // Skip \r inside quotes
      } else if (inQuotes && char === '\n') {
        normalizedText += '___NEWLINE___';
      } else {
        normalizedText += char;
      }
    }

    const rows = normalizedText.split(/\r?\n/).filter(r => r.trim() !== '');
    setEditedGrid(prev => {
      const nextGrid = { ...prev };
      
      rows.forEach((row, rIdx) => {
        const targetDayIndex = startDayIndex + rIdx;
        if (targetDayIndex >= daysInMonthList.length) return;
        
        const dateStr = daysInMonthList[targetDayIndex].dateStr;
        const cells = row.split('\t');
        
        cells.forEach((cellVal, cIdx) => {
          const targetShiftIndex = startShiftIndex + cIdx;
          if (targetShiftIndex > 4) return;
          
          let cleanVal = cellVal.replace(/___NEWLINE___/g, '\n');
          // Remove surrounding quotes if Excel added them
          if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
            cleanVal = cleanVal.slice(1, -1);
          }
          // Excel escapes internal quotes as ""
          cleanVal = cleanVal.replace(/""/g, '"');

          let shiftCol;
          if (targetShiftIndex === 0) shiftCol = 'AM';
          else if (targetShiftIndex === 1) shiftCol = 'PM';
          else if (targetShiftIndex === 2) shiftCol = 'NIGHT';
          else if (targetShiftIndex === 3) shiftCol = 'EP_OFFICE_HOUR';
          else shiftCol = 'EP_ONCALL';

          if (shiftCol === 'EP_OFFICE_HOUR' || shiftCol === 'EP_ONCALL') {
            // EP columns: simple overwrite, no name-overlap cleaning
            if (!nextGrid[dateStr]) nextGrid[dateStr] = { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' };
            nextGrid[dateStr][shiftCol] = cleanVal.trim();
          } else {
            nextGrid[dateStr] = cleanDayDataForNameOverlap(
              nextGrid[dateStr] || { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' },
              shiftCol,
              cleanVal.trim()
            );
          }
        });
      });
      return nextGrid;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const flatRows = [];
      Object.keys(editedGrid).forEach((dateStr) => {
        Object.keys(editedGrid[dateStr]).forEach((shift) => {
          const namesStr = editedGrid[dateStr][shift];
          if (namesStr) {
            namesStr.split(/[\n,]+/).forEach(n => {
              const name = n.trim();
              if (name) {
                flatRows.push({ name, date: dateStr, shift });
              }
            });
          }
        });
      });
      
      if (!flatRows.length && !confirm("You are about to save an EMPTY roster. This will delete all shifts for the month. Continue?")) {
         setIsSaving(false);
         return;
      }
      
      await onUploadMasterRoster(flatRows);
      setIsEditMode(false);
      setIsStandbyEditMode(false);
      setIsSaving(false);
      // Show refreshing state while App.jsx reloads from Sheets
      setIsRefreshing(true);
      // App.jsx already has a 1.5s delay built in; wait a bit extra to be safe
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsRefreshing(false);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
      setIsSaving(false);
      setIsRefreshing(false);
    }
  };

  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  const openExportModal = () => {
    setExportSettings((prev) => ({
      ...prev,
      monthYear: monthLabel,
    }));
    setIsExportModalOpen(true);
  };

  const handleExportSettingChange = (key, value) => {
    setExportSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleExportSubmit = (e) => {
    e.preventDefault();
    const basePath = import.meta.env.BASE_URL || '/';
    const logoPath = `${basePath.replace(/\/$/, '')}/logo-ed-hsaas.png`;
    const logoUrl = new URL(logoPath, window.location.origin).href;

    try {
      openRosterPdfExport({
        ...exportSettings,
        logoUrl,
        rows: exportRows,
        contacts: exportContacts,
      });
      setIsExportModalOpen(false);
    } catch (error) {
      alert(error.message || 'Unable to open PDF export.');
    }
  };

  return (
    <div className={`mx-auto px-2 sm:px-6 py-6 sm:py-8 md:px-8 animate-fadeIn ${
      activeTab === 'table' ? 'w-full max-w-none' : 'max-w-5xl'
    }`}>
      {/* 🧭 Header Details */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold flex items-center gap-2">
              <span>📅</span>
              <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Current Roster</span>
            </h1>
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Displaying the official finalized schedule for <span className="font-bold text-slate-700">{monthLabel}</span>.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handlePrevMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹ Prev
            </button>
            <button
              onClick={handleCurrentMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Current Month
            </button>
            <button
              onClick={handleNextMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next ›
            </button>
          </div>
        </div>
      </div>

      {/* 🧭 Tab Control */}
      <div className="flex justify-between items-center border-b border-slate-200 mb-6 select-none">
        <div className="flex">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition-all -mb-px ${
              activeTab === 'calendar'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            📅 Calendar View
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition-all -mb-px ${
              activeTab === 'table'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            📊 Table View
          </button>
        </div>

        {/* Action Buttons on the Right */}
        {isAdmin && (
          <div className="flex items-center gap-2 pb-1.5 pr-2">
            {!isEditMode && !isStandbyEditMode && !isExtendedEditMode && (
              <button
                type="button"
                onClick={openExportModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
              >
                PDF Export
              </button>
            )}
            {!isStandbyEditMode && !isExtendedEditMode && (
              <button
                onClick={toggleEditMode}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                }`}
              >
                {isEditMode ? '✕ Cancel Edit' : '✏️ Edit Roster'}
              </button>
            )}
            {!isEditMode && !isExtendedEditMode && (
              <button
                onClick={toggleStandbyEditMode}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isStandbyEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                }`}
              >
                {isStandbyEditMode ? '✕ Cancel Standby' : '⭐ Edit Standby'}
              </button>
            )}
            {!isEditMode && !isStandbyEditMode && (
              <button
                onClick={toggleExtendedEditMode}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isExtendedEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                {isExtendedEditMode ? '✕ Cancel Extended' : '✨ Edit Extended'}
              </button>
            )}
            {(isEditMode || isStandbyEditMode || isExtendedEditMode) && (
              <button
                onClick={handleSave}
                disabled={isSaving || isRefreshing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-70"
              >
                {isSaving ? '💾 Saving...' : isRefreshing ? '🔄 Refreshing...' : '💾 Save Changes'}
              </button>
            )}
          </div>
        )}
      </div>

      {isEditMode && (
         <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm animate-fadeIn">
           {activeTab === 'calendar' ? (
             <span>
               <strong className="font-bold">Excel Editing Mode Active (Calendar):</strong> You can type directly into cells. Multiple names must be separated by commas or <strong>Alt+Enter</strong>. You can use <strong>Arrow Keys</strong>, <strong>Enter</strong>, or <strong>Tab</strong> to navigate. You can also paste directly from an Excel spreadsheet range.
             </span>
           ) : (
             <span>
               <strong className="font-bold">Table Editing Mode Active (Spreadsheet):</strong> You can select shifts (AM, PM, NIGHT) or remove them using the dropdowns for each doctor. Your modifications are kept in sync with the Calendar View and will be saved together!
             </span>
           )}
         </div>
      )}

      {isStandbyEditMode && (
         <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm animate-fadeIn">
           <span>
             <strong className="font-bold">Standby Editing Mode Active:</strong> You can click on any assigned shift or leave cell in the table below to toggle standby status (indicated by the amber <strong className="font-extrabold">S</strong> badge). Your changes will be saved to Google Sheets.
           </span>
         </div>
      )}

      {isExtendedEditMode && (
         <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800 shadow-sm animate-fadeIn">
           <span>
             <strong className="font-bold">Extended Shift Editing Mode Active:</strong> You can click on any assigned shift or leave cell in the table below to toggle extended shift status (indicated by the blue <strong className="font-extrabold">EX</strong> badge). Your changes will be saved to Google Sheets.
           </span>
         </div>
      )}

      {daysInMonthList.length > 0 && activeTab === 'calendar' && (
        /* 📊 Finalized Monthly Table Card (Calendar View) */
        <div className={`rounded-3xl border bg-white p-1 shadow-sm overflow-hidden transition-all duration-300 ${isEditMode ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-150/70'}`}>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-slate-300 text-center font-sans text-sm">
              <thead>
                {/* Row 1 Header */}
                <tr className="bg-slate-800 text-white border border-slate-800 select-none">
                  <th
                    rowSpan={2}
                    className="border border-slate-300 px-1 sm:px-4 py-2 sm:py-3 font-bold align-middle uppercase tracking-wider text-[9px] sm:text-xs w-8 sm:w-16"
                  >
                    DATE
                  </th>
                  <th
                    rowSpan={2}
                    className="border border-slate-300 px-1 sm:px-4 py-2 sm:py-3 font-bold align-middle uppercase tracking-wider text-[9px] sm:text-xs w-10 sm:w-16"
                  >
                    DAY
                  </th>
                  <th
                    colSpan={3}
                    className="border border-slate-300 px-1.5 sm:px-4 py-2 sm:py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs bg-slate-750"
                  >
                    MEDICAL OFFICER
                  </th>
                  <th
                    colSpan={2}
                    className="border border-slate-300 px-1.5 sm:px-4 py-2 sm:py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs bg-teal-700"
                  >
                    EMERGENCY PHYSICIAN
                  </th>
                </tr>
                {/* Row 2 Header */}
                <tr className="bg-slate-700 text-white border border-slate-700 select-none">
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    AM
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    PM
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    NIGHT
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5 bg-teal-700/80">
                    OFFICE HOUR
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5 bg-teal-700/80">
                    ON CALL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {daysInMonthList.map(({ dayNum, dayName, dateStr }, dayIndex) => {
                  const dayAssignments = rosterGrid[dateStr] || { AM: [], PM: [], NIGHT: [] };
                  const isWeekend = dayName === 'SAT' || dayName === 'SUN';
                  const isToday = dateStr === todayStr;
                  const holidayName = getHolidayName(dateStr);
                  const isHoliday = !!holidayName;

                  return (
                    <tr
                      key={dateStr}
                      className={`transition-colors border border-slate-300 ${
                        isToday
                          ? 'bg-indigo-50/80 hover:bg-indigo-100/60 ring-1 ring-inset ring-indigo-300'
                          : isHoliday
                          ? 'bg-rose-50/60 hover:bg-rose-100/50'
                          : isWeekend 
                          ? 'bg-slate-100/80 hover:bg-slate-200/50' 
                          : 'bg-white hover:bg-slate-50/50'
                      }`}
                    >
                      {/* Date */}
                      <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                        isToday ? 'text-indigo-900 bg-indigo-100/50' : isHoliday ? 'text-rose-700' : 'text-slate-800'
                      }`}>
                        {dayNum}
                        {isToday && <span className="block text-[8px] sm:text-[9px] text-indigo-600 mt-0.5">TODAY</span>}
                        {isHoliday && !isToday && <span className="block text-[7px] sm:text-[8px] text-rose-500 font-extrabold mt-0.5 uppercase leading-tight">PH</span>}
                      </td>

                      {/* Day Name */}
                      <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                        isToday ? 'text-indigo-900 bg-indigo-100/50' : isHoliday ? 'text-rose-700' : isWeekend ? 'text-indigo-600' : 'text-slate-600'
                      }`}>
                        {dayName}
                        {isHoliday && <span className="block text-[7px] sm:text-[8px] text-rose-500 font-bold mt-0.5 normal-case truncate max-w-[4rem]" title={holidayName}>{holidayName}</span>}
                      </td>


                      {/* Medical Officer Shift Cells (AM, PM, NIGHT) */}
                      {['AM', 'PM', 'NIGHT'].map((shiftCol, shiftIndex) => (
                        <td key={shiftCol} className="border border-slate-300 p-0 align-middle h-14">
                          {isEditMode ? (
                            <textarea
                              id={`cell-${dayIndex}-${shiftIndex}`}
                              value={
                                shiftCol === 'NIGHT'
                                  ? getNightShiftNamesFromGrid(editedGrid[dateStr])
                                  : (editedGrid[dateStr]?.[shiftCol] ?? '')
                              }
                              onChange={(e) => handleCellChange(dateStr, shiftCol, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, dateStr, shiftCol, dayIndex, shiftIndex)}
                              onPaste={(e) => handlePaste(e, dayIndex, shiftIndex)}
                              className={`w-full h-full min-h-[3.5rem] px-0.5 sm:px-4 py-1 sm:py-2 text-center text-[10px] sm:text-sm font-bold bg-transparent outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 transition-all hover:bg-slate-50 focus:bg-white resize-none overflow-hidden ${
                                isWeekend ? 'text-indigo-900' : 'text-slate-800'
                              }`}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-2">
                              {dayAssignments[shiftCol].length > 0 ? (
                                dayAssignments[shiftCol].map((name) => {
                                  const nameKey = normalizeForComparison(name);
                                  const rawShift = doctorRosterMap.get(nameKey)?.get(dateStr) || '';
                                  const isDocStandby = parseShiftValue(rawShift).isStandby;
                                  return (
                                    <span
                                      key={name}
                                      className={`inline-flex items-center gap-1 tracking-wide uppercase text-[9px] sm:text-xs font-bold transition-all px-1 sm:px-1.5 py-0.5 rounded-lg ${
                                        isMatch(name)
                                          ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300 animate-pulse scale-105 shadow-sm'
                                          : 'text-slate-700'
                                      }`}
                                    >
                                      <span>{name}</span>
                                      {isDocStandby && (
                                        <span className="inline-flex items-center justify-center px-0.5 rounded bg-amber-500 text-white text-[8px] font-extrabold min-w-[10px] h-[10px] select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      {parseShiftValue(rawShift).isExtended && (
                                        <span className="inline-flex items-center justify-center px-0.5 rounded bg-blue-500 text-white text-[8px] font-extrabold min-w-[10px] h-[10px] select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="text-slate-300 text-xs">-</span>
                              )}
                            </div>
                          )}
                        </td>
                      ))}

                      {/* Emergency Physician Cells (Office Hour + On Call) */}
                      {[['EP_OFFICE_HOUR', 3], ['EP_ONCALL', 4]].map(([epKey, shiftIndex]) => {
                        const epVal = isEditMode
                          ? (editedGrid[dateStr]?.[epKey] ?? '')
                          : (() => {
                              // Read from masterRoster directly for EP fields
                              const raw = masterRoster.filter(r => {
                                const d = toIsoDate(r.Date || r.date);
                                const s = String(r.Shift || r.shift || '').trim().toUpperCase();
                                return d === dateStr && s === epKey;
                              });
                              return raw.map(r => String(r.Name || r.name || '').trim()).filter(Boolean).join(', ');
                            })();
                        return (
                          <td key={epKey} className={`border border-slate-300 p-0 align-middle h-14 ${
                            isToday ? 'bg-teal-50/30' : isWeekend ? 'bg-teal-50/20' : 'bg-teal-50/10'
                          }`}>
                            {isEditMode ? (
                              <textarea
                                id={`cell-${dayIndex}-${shiftIndex}`}
                                value={epVal}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditedGrid(prev => ({
                                    ...prev,
                                    [dateStr]: { ...(prev[dateStr] || {}), [epKey]: val }
                                  }));
                                }}
                                onKeyDown={(e) => handleKeyDown(e, dateStr, epKey, dayIndex, shiftIndex)}
                                onPaste={(e) => handlePaste(e, dayIndex, shiftIndex)}
                                className={`w-full h-full min-h-[3.5rem] px-0.5 sm:px-4 py-1 sm:py-2 text-center text-[10px] sm:text-sm font-bold bg-transparent outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 transition-all hover:bg-teal-50/50 focus:bg-white resize-none overflow-hidden ${
                                  isWeekend ? 'text-teal-800' : 'text-teal-700'
                                }`}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-2">
                                {epVal ? (
                                  epVal.split(/[,\n]+/).map(n => n.trim()).filter(Boolean).map(name => (
                                    <span
                                      key={name}
                                      className={`inline-flex items-center tracking-wide text-[9px] sm:text-xs font-bold transition-all px-1 sm:px-1.5 py-0.5 rounded-lg ${
                                        isMatch(name)
                                          ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300 animate-pulse scale-105 shadow-sm'
                                          : 'text-teal-700'
                                      }`}
                                    >
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-slate-300 text-xs">-</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {daysInMonthList.length > 0 && activeTab === 'table' && (
        <>
          {/* 📊 Finalized Monthly Spreadsheet Card (Table View) */}
          <div className={`rounded-3xl border bg-white p-1 shadow-sm overflow-hidden transition-all duration-300 ${isEditMode ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-150/70'}`}>
            <div className="overflow-x-auto" ref={rosterScrollRef}>
              <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
                <thead>
                  <tr className="bg-slate-800 text-white select-none">
                    <th className="sticky left-0 z-20 bg-slate-800 px-3 py-3 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-200 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                      Name
                    </th>
                    {daysInMonthList.map((day) => {
                      const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                      const holidayName = getHolidayName(day.dateStr);
                      const isHoliday = !!holidayName;
                      return (
                        <th
                          key={day.dateStr}
                          className={`whitespace-nowrap border-b border-slate-200 px-2.5 py-3 font-bold uppercase tracking-wider text-[10px] sm:text-xs min-w-[3.8rem] ${
                            day.dayName === 'SUN' ? 'border-r-2 border-r-slate-500' : 'border-r border-slate-700/40'
                          } ${
                            isHoliday ? 'bg-rose-950 text-rose-100 ring-1 ring-rose-900/20' : isWeekendDay ? 'bg-slate-900' : 'bg-slate-800'
                          }`}
                          title={isHoliday ? holidayName : undefined}
                        >
                          <div>{day.dayNum}</div>
                          <div className={`text-[8px] ${isHoliday ? 'text-rose-200 font-extrabold' : 'opacity-75'}`}>{day.dayName}</div>
                          {isHoliday && <div className="text-[7px] text-rose-300 font-bold truncate max-w-[3.5rem]">{holidayName.toUpperCase()}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
              <tbody>
                {names.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-xs sm:text-sm text-slate-500 text-left"
                      colSpan={daysInMonthList.length + 1}
                    >
                      No team members available.
                    </td>
                  </tr>
                ) : (
                  names.map((name) => {
                    const nameKey = normalizeForComparison(name);
                    const matched = isMatch(name);
                    return (
                      <tr key={name} className="hover:bg-slate-50/50 transition-colors">
                        <th
                          className={`sticky left-0 z-10 px-3 py-2 text-left font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 transition-colors min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate ${
                            matched
                              ? 'bg-amber-100 text-amber-900 ring-2 ring-amber-300'
                              : 'bg-white'
                          }`}
                        >
                          {name.toUpperCase()}
                        </th>
                        {daysInMonthList.map((day) => {
                          const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                          const isToday = day.dateStr === todayStr;
                          const holidayName = getHolidayName(day.dateStr);
                          const isHoliday = !!holidayName;
                          
                          let cellBg = isToday 
                            ? 'bg-indigo-50/40' 
                            : isHoliday
                            ? 'bg-rose-100/60'
                            : isWeekendDay 
                            ? 'bg-slate-100/80' 
                            : 'bg-white';
 
                          let val = '';
                          if (isEditMode || isStandbyEditMode || isExtendedEditMode) {
                            val = getEditingShift(day.dateStr, name);
                          } else {
                            val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
                            if (!val && isUpcomingMonth) {
                              const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
                              if (reqData) {
                                val = reqData.shift;
                              }
                            }
                          }
  
                          const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
                          const cleanVal = val ? parseShiftValue(val).cleanShift : '';
                          const isRequested = !!(reqData && cleanVal.toUpperCase() === reqData.shift.toUpperCase());
                          const hasOverride = reqData && cleanVal.toUpperCase() !== reqData.shift.toUpperCase();

                          let cellTooltip = '';
                          if (reqData) {
                            const comment = reqData.comment || '';
                            if (hasOverride) {
                              cellTooltip = `Requested: ${reqData.shift}${comment ? `\nComment: "${comment}"` : ''}`;
                            } else if (comment) {
                              cellTooltip = `Request Comment: "${comment}"`;
                            }
                          }

                          const selectClass = `w-full text-center text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} rounded-lg border px-1.5 py-1 outline-none transition-all cursor-pointer ${getShiftBadgeClass(val, isRequested)}`;
 
                          return (
                            <td
                              key={day.dateStr}
                              className={`border-b p-1.5 h-10 min-w-[3.8rem] align-middle ${
                                day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300' : 'border-r border-slate-100'
                              } ${cellBg}`}
                            >
                              <div className="relative w-full h-full flex items-center justify-center">
                                {isStandbyEditMode ? (
                                  val ? (
                                    <button
                                      onClick={() => handleToggleStandby(day.dateStr, name)}
                                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} transition-all shadow-sm active:scale-95 ${
                                        parseShiftValue(val).isStandby
                                          ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
                                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                                      }`}
                                      title={parseShiftValue(val).isStandby ? "Click to remove standby" : "Click to set standby"}
                                    >
                                      <span>{parseShiftValue(val).cleanShift}</span>
                                      <span className={`inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold leading-none min-w-[12px] h-[12px] ${
                                        parseShiftValue(val).isStandby ? 'bg-white text-amber-600' : 'bg-slate-200 text-slate-600'
                                      }`}>
                                        S
                                      </span>
                                      {parseShiftValue(val).isExtended && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-blue-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                ) : isExtendedEditMode ? (
                                  val ? (
                                    <button
                                      onClick={() => handleToggleExtended(day.dateStr, name)}
                                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} transition-all shadow-sm active:scale-95 ${
                                        parseShiftValue(val).isExtended
                                          ? 'bg-blue-500 hover:bg-blue-600 text-white border-blue-600'
                                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                                      }`}
                                      title={parseShiftValue(val).isExtended ? "Click to remove extended shift" : "Click to set extended shift"}
                                    >
                                      <span>{parseShiftValue(val).cleanShift}</span>
                                      {parseShiftValue(val).isStandby && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-amber-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      <span className={`inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold leading-none min-w-[12px] h-[12px] ${
                                        parseShiftValue(val).isExtended ? 'bg-white text-blue-600' : 'bg-slate-200 text-slate-600'
                                      }`}>
                                        EX
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                ) : isEditMode ? (
                                  <select
                                    value={parseShiftValue(val).cleanShift}
                                    onChange={(e) => handleTableEditCellChange(day.dateStr, name, e.target.value)}
                                    className={selectClass}
                                    title={cellTooltip}
                                  >
                                    <option value="">-</option>
                                    {dropdownShifts.map((shiftOpt) => (
                                      <option key={shiftOpt} value={shiftOpt}>
                                        {shiftOpt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  val ? (
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} ${getShiftBadgeClass(val, isRequested)}`} title={cellTooltip}>
                                      {parseShiftValue(val).cleanShift}
                                      {parseShiftValue(val).isStandby && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-amber-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      {parseShiftValue(val).isExtended && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-blue-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                )}
                                {reqData && reqData.comment && (
                                  <span className="absolute -top-1 -left-1 flex h-2 w-2 cursor-help" title={cellTooltip}>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                                  </span>
                                )}
                                {hasOverride && (
                                  <span className="absolute -top-1 -right-1 flex h-2 w-2 cursor-help" title={cellTooltip}>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📊 Shift Distribution Tally Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white p-1 shadow-sm overflow-hidden transition-all duration-300">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <span>📊</span> Shift Distribution Tally
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">Counts per shift type</span>
          </div>
          <div className="overflow-x-auto/no-scrollbar" ref={tallyScrollRef} style={{ overflowX: 'auto' }}>
            <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                  <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                    Shift Type
                  </th>
                  {daysInMonthList.map((day) => {
                    const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                    const holidayName = getHolidayName(day.dateStr);
                    const isHoliday = !!holidayName;
                    return (
                      <th
                        key={day.dateStr}
                        className={`whitespace-nowrap border-b px-2.5 py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs min-w-[3.8rem] ${
                          day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300' : 'border-r border-slate-100'
                        } ${
                          isHoliday ? 'bg-rose-100/60 text-rose-800' : isWeekendDay ? 'bg-slate-200/60' : 'bg-slate-50'
                        }`}
                        title={isHoliday ? holidayName : undefined}
                      >
                        <div>{day.dayNum}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tallyData.shifts.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-xs text-slate-500 text-left"
                      colSpan={daysInMonthList.length + 1}
                    >
                      No active shifts assigned.
                    </td>
                  </tr>
                ) : (
                  tallyData.shifts.map((shiftType) => {
                    const isTotalLeave = shiftType === 'TOTAL LEAVE';
                    return (
                      <tr key={shiftType} className={`hover:bg-slate-50/50 transition-colors ${isTotalLeave ? 'bg-slate-50/80 border-t border-slate-200 font-extrabold shadow-sm' : ''}`}>
                        <th className={`sticky left-0 z-10 px-3 py-1.5 text-left font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate ${isTotalLeave ? 'bg-slate-50/90 font-extrabold' : 'bg-white'}`}>
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${getShiftBadgeClass(shiftType)}`}>
                            {shiftType}
                          </span>
                        </th>
                        {daysInMonthList.map((day) => {
                          const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                          const isToday = day.dateStr === todayStr;
                          const holidayName = getHolidayName(day.dateStr);
                          const isHoliday = !!holidayName;
                          
                          let cellBg = isToday 
                            ? 'bg-indigo-50/40' 
                            : isHoliday
                            ? 'bg-rose-100/60'
                            : isWeekendDay 
                            ? 'bg-slate-100/80' 
                            : 'bg-white';
                          
                          if (isTotalLeave && !isToday) {
                            cellBg = isWeekendDay ? 'bg-indigo-50/10' : 'bg-indigo-50/5';
                          }
                          
                          const count = tallyData.tallyMap.get(day.dateStr)?.get(shiftType) || 0;
                          const amCount = tallyData.tallyMap.get(day.dateStr)?.get('AM') || 0;
                          const pmCount = tallyData.tallyMap.get(day.dateStr)?.get('PM') || 0;

                          let hasAlert = false;
                          let alertMsg = '';
                          if (shiftType === 'AM') {
                            if (count < tallyThresholds.amMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below AM minimum of ${tallyThresholds.amMin}`;
                            } else if (count > pmCount) {
                              hasAlert = true;
                              alertMsg = `Alert: AM count (${count}) exceeds PM count (${pmCount})`;
                            }
                          } else if (shiftType === 'PM') {
                            if (count < tallyThresholds.pmMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below PM minimum of ${tallyThresholds.pmMin}`;
                            } else if (count < amCount) {
                              hasAlert = true;
                              alertMsg = `Alert: PM count (${count}) is less than AM count (${amCount})`;
                            }
                          } else if (shiftType === 'NIGHT') {
                            if (count < tallyThresholds.nightMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below Night minimum of ${tallyThresholds.nightMin}`;
                            } else if (count > tallyThresholds.nightMax) {
                              hasAlert = true;
                              alertMsg = `Alert: Exceeds Night maximum of ${tallyThresholds.nightMax}`;
                            }
                          } else if (shiftType === 'TOTAL LEAVE' && count > tallyThresholds.totalLeaveMax) {
                            hasAlert = true;
                            alertMsg = `Alert: Exceeds Total Leave maximum of ${tallyThresholds.totalLeaveMax}`;
                          }

                          let cellClass = `border-b p-1.5 h-8 min-w-[3.8rem] align-middle transition-colors font-bold ${
                            day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300' : 'border-r border-slate-100'
                          }`;
                          if (hasAlert) {
                            cellClass += ` bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
                          } else {
                            cellClass += ` ${isTotalLeave ? 'text-indigo-700' : 'text-slate-800'} ${cellBg}`;
                          }

                          return (
                            <td
                              key={day.dateStr}
                              className={cellClass}
                              title={alertMsg || `${shiftType} count: ${count}`}
                            >
                              {count > 0 ? (
                                <span className={`text-xs font-extrabold ${hasAlert ? 'text-rose-700' : isTotalLeave ? 'text-indigo-700' : 'text-slate-900'}`}>
                                  {count}
                                  {hasAlert && <span className="ml-0.5 text-[9px]">⚠️</span>}
                                </span>
                              ) : (
                                <span className={hasAlert ? 'text-rose-400 font-extrabold text-xs' : 'text-slate-350'}>
                                  {hasAlert ? '0 ⚠️' : '-'}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* 👤 Individual Member Shift Tally Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white shadow-sm overflow-hidden transition-all duration-300">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <span>👤</span> Individual Member Shift Tally
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">{memberTallyData.length} members · {daysInMonthList.length} days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                  <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2.5 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                    Name
                  </th>
                  {['AM', 'PM', 'NIGHT', 'PN', 'GHKA', 'TOTAL LEAVES'].map((col) => (
                    <th
                      key={col}
                      className={`px-3 py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs whitespace-nowrap border-l border-slate-100 ${
                        col === 'TOTAL LEAVES'
                          ? 'bg-indigo-50/60 text-indigo-700 min-w-[5.5rem]'
                          : col === 'AM'
                          ? 'bg-green-50/60 text-green-700 min-w-[3.2rem]'
                          : col === 'PM'
                          ? 'bg-amber-50/60 text-amber-700 min-w-[3.2rem]'
                          : col === 'NIGHT'
                          ? 'bg-red-50/60 text-red-700 min-w-[3.6rem]'
                          : col === 'PN'
                          ? 'bg-purple-50/60 text-purple-700 min-w-[3.2rem]'
                          : 'bg-slate-100/60 text-slate-700 min-w-[3.8rem]'
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memberTallyData.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-xs text-slate-500 text-left" colSpan={7}>
                      No team members available.
                    </td>
                  </tr>
                ) : (
                  memberTallyData.map((entry) => {
                    const nameKey = normalizeForComparison(entry.name);
                    const matched = isMatch(entry.name);
                    const cols = [
                      { key: 'AM',          val: entry.AM,          color: 'text-green-700',  bg: 'bg-green-50/30' },
                      { key: 'PM',          val: entry.PM,          color: 'text-amber-700',  bg: 'bg-amber-50/30' },
                      { key: 'NIGHT',       val: entry.NIGHT,       color: 'text-red-700',    bg: 'bg-red-50/30'   },
                      { key: 'PN',          val: entry.PN,          color: 'text-purple-700', bg: 'bg-purple-50/30'},
                      { key: 'GHKA',        val: entry.GHKA,        color: 'text-slate-700',  bg: ''               },
                      { key: 'TOTAL_LEAVE', val: entry.TOTAL_LEAVE, color: 'text-indigo-700', bg: 'bg-indigo-50/30'},
                    ];
                    return (
                      <tr
                        key={nameKey}
                        className={`hover:bg-slate-50/60 transition-colors border-b border-slate-100/80 ${
                          matched ? 'bg-amber-50/40 ring-1 ring-inset ring-amber-200' : ''
                        }`}
                      >
                        <th
                          className={`sticky left-0 z-10 px-3 py-1.5 text-left font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate text-[10px] sm:text-xs ${
                            matched ? 'bg-amber-50 text-amber-900' : 'bg-white'
                          }`}
                        >
                          {entry.name.toUpperCase()}
                        </th>
                        {cols.map(({ key, val, color, bg }) => (
                          <td
                            key={key}
                            className={`px-3 py-1.5 border-l border-slate-100 font-bold align-middle ${
                              val > 0 ? color : 'text-slate-300'
                            } ${bg}`}
                          >
                            {val > 0 ? val : <span className="text-slate-300">-</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* ⚙️ Tally Alert Threshold Settings Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm transition-all duration-300 animate-fadeIn">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
              <span className="text-lg">⚙️</span>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Tally Alert Threshold Settings
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">AM Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.amMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, amMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">PM Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.pmMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, pmMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Night Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.nightMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, nightMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Night Max</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.nightMax}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, nightMax: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Max Total Leave</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.totalLeaveMax}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, totalLeaveMax: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
            </div>
          </div>
        )}
      </>
    )}

      {daysInMonthList.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <span className="text-4xl block mb-2">📅</span>
          <p className="font-semibold text-sm">No roster records detected for the selected month.</p>
        </div>
      )}
      {isExportModalOpen && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">Roster PDF Export</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Creates a print-ready roster document using the export layout.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="rounded-full px-2 py-1 text-lg font-bold leading-none text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleExportSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Main title
                </label>
                <input
                  type="text"
                  value={exportSettings.mainTitle}
                  onChange={(e) => handleExportSettingChange('mainTitle', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Roster type
                  </label>
                  <select
                    value={exportSettings.rosterType}
                    onChange={(e) => handleExportSettingChange('rosterType', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  >
                    <option value="MO & EP ROSTER">MO &amp; EP ROSTER</option>
                    <option value="EP ROSTER">EP ROSTER</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Month/year
                  </label>
                  <input
                    type="text"
                    value={exportSettings.monthYear}
                    onChange={(e) => handleExportSettingChange('monthYear', e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Version
                </label>
                <input
                  type="text"
                  value={exportSettings.version}
                  onChange={(e) => handleExportSettingChange('version', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Optional notes
                </label>
                <textarea
                  rows="3"
                  value={exportSettings.notes}
                  onChange={(e) => handleExportSettingChange('notes', e.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div className="flex gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsExportModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white shadow-md shadow-indigo-100 transition hover:bg-indigo-700"
                >
                  Generate PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
