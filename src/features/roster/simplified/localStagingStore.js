import {
  buildCellsMapFromEditedGrid,
  diffBaselineAndEditedCells,
  normalizeShiftComparison,
  resolveStaffIdentity,
} from './rosterComposition.js';
import { normalizeForComparison } from '../../../utils/normalise.js';
import { mapName } from '../../../utils/adapters.js';

const STORAGE_PREFIX = 'resq_simplified_staging_v1:';
const IDB_NAME = 'SimplifiedRosterStagingDB';
const IDB_VERSION = 1;
const IDB_STORE = 'monthDrafts';
const MAX_HISTORY = 50;

export const SAVE_STATUS = {
  EDITING: 'Editing',
  UNSAVED_CHANGES: 'Unsaved Changes',
  SAVING: 'Saving',
  SAVED: 'Saved',
  CONFLICT: 'Conflict',
  SAVE_FAILED: 'Save Failed',
};

// In-memory store keyed by rosterMonth (YYYY-MM)
const memorySessions = new Map();
const listeners = new Set();

function notifyListeners(rosterMonth) {
  for (const fn of listeners) {
    try {
      fn(rosterMonth);
    } catch (_) {}
  }
}

export function subscribeStagingStore(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function generateOperationId(rosterMonth) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `op_${rosterMonth}_${Date.now()}_${rand}`;
}

function deepCloneGrid(grid) {
  if (!grid || typeof grid !== 'object') return {};
  const copy = {};
  for (const dateKey of Object.keys(grid)) {
    copy[dateKey] = { ...(grid[dateKey] || {}) };
  }
  return copy;
}

function serializeCellsMap(cellsMap) {
  const obj = {};
  if (cellsMap instanceof Map) {
    for (const [k, v] of cellsMap.entries()) {
      obj[k] = {
        cellKey: v.cellKey || k,
        rosterMonth: v.rosterMonth,
        date: v.date,
        targetType: v.targetType,
        field: v.field,
        staffKey: v.staffKey,
        staffName: v.staffName,
        value: String(v.effectiveValue ?? v.value ?? '').trim(),
      };
    }
  } else if (cellsMap && typeof cellsMap === 'object') {
    for (const [k, v] of Object.entries(cellsMap)) {
      obj[k] = { ...v };
    }
  }
  return obj;
}

export function deserializeCellsObject(cellsObj) {
  const map = new Map();
  if (!cellsObj || typeof cellsObj !== 'object') return map;
  for (const [k, v] of Object.entries(cellsObj)) {
    map.set(k, { ...v, effectiveValue: v.value ?? v.effectiveValue ?? '' });
  }
  return map;
}

function writeLocalStorage(rosterMonth, record) {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      if (!record || (!record.hasUnsavedEdits && (!record.undoStack || record.undoStack.length === 0))) {
        globalThis.localStorage.removeItem(STORAGE_PREFIX + rosterMonth);
      } else {
        const payload = {
          rosterMonth: record.rosterMonth,
          editedGrid: record.editedGrid,
          baseCellsObj: record.baseCellsObj,
          baseChecksum: record.baseChecksum,
          undoStack: record.undoStack,
          redoStack: record.redoStack,
          pendingOperationId: record.pendingOperationId,
          hasUnsavedEdits: record.hasUnsavedEdits,
          updatedAt: record.updatedAt,
        };
        globalThis.localStorage.setItem(STORAGE_PREFIX + rosterMonth, JSON.stringify(payload));
      }
    }
  } catch (_) {}
}

function readLocalStorage(rosterMonth) {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      const raw = globalThis.localStorage.getItem(STORAGE_PREFIX + rosterMonth);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.rosterMonth === rosterMonth && parsed.hasUnsavedEdits) {
        return parsed;
      }
    }
  } catch (_) {}
  return null;
}

function openIdb() {
  return new Promise((resolve) => {
    try {
      if (typeof globalThis.indexedDB === 'undefined' || !globalThis.indexedDB) {
        resolve(null);
        return;
      }
      const req = globalThis.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'rosterMonth' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function writeIdb(rosterMonth, record) {
  const db = await openIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    if (!record || !record.hasUnsavedEdits) {
      store.delete(rosterMonth);
    } else {
      store.put({
        rosterMonth: record.rosterMonth,
        editedGrid: record.editedGrid,
        baseCellsObj: record.baseCellsObj,
        baseChecksum: record.baseChecksum,
        undoStack: record.undoStack,
        redoStack: record.redoStack,
        pendingOperationId: record.pendingOperationId,
        hasUnsavedEdits: record.hasUnsavedEdits,
        updatedAt: record.updatedAt,
      });
    }
  } catch (_) {} finally {
    try { db.close(); } catch (_) {}
  }
}

export async function readIdbMonthDraft(rosterMonth) {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(rosterMonth);
      req.onsuccess = () => {
        try { db.close(); } catch (_) {}
        const val = req.result;
        resolve(val && val.hasUnsavedEdits ? val : null);
      };
      req.onerror = () => {
        try { db.close(); } catch (_) {}
        resolve(null);
      };
    } catch (_) {
      try { db.close(); } catch (_) {}
      resolve(null);
    }
  });
}

function persistRecord(rosterMonth, record) {
  writeLocalStorage(rosterMonth, record);
  void writeIdb(rosterMonth, record);
}

/**
 * Computes changedCells for a session record.
 */
export function computeSessionChanges(session, names = [], teamMembers = []) {
  if (!session || !session.editedGrid) return [];
  const baseCellsMap = deserializeCellsObject(session.baseCellsObj);
  const editedCellsMap = buildCellsMapFromEditedGrid({
    editedGrid: session.editedGrid,
    rosterMonth: session.rosterMonth,
    names,
    teamMembers,
    baseCellsMap,
  });
  return diffBaselineAndEditedCells({
    baseCellsMap,
    editedCellsMap,
    rosterMonth: session.rosterMonth,
  });
}

/**
 * Initializes or retrieves a month's local staging session.
 * If unsaved edits exist in memory or localStorage for this month, they are preserved!
 */
export function getOrInitMonthStaging({
  rosterMonth,
  initialGridFactory,
  serverCellsMap,
  serverChecksum,
  names = [],
  teamMembers = [],
}) {
  const existingMem = memorySessions.get(rosterMonth);
  if (existingMem && existingMem.hasUnsavedEdits) {
    return existingMem;
  }

  const stored = readLocalStorage(rosterMonth);
  if (stored && stored.hasUnsavedEdits && stored.editedGrid) {
    const restored = {
      rosterMonth,
      editedGrid: deepCloneGrid(stored.editedGrid),
      baseCellsObj: stored.baseCellsObj || serializeCellsMap(serverCellsMap),
      baseChecksum: stored.baseChecksum || serverChecksum || '',
      undoStack: Array.isArray(stored.undoStack) ? stored.undoStack : [],
      redoStack: Array.isArray(stored.redoStack) ? stored.redoStack : [],
      pendingOperationId: stored.pendingOperationId || generateOperationId(rosterMonth),
      hasUnsavedEdits: true,
      status: SAVE_STATUS.UNSAVED_CHANGES,
      lastError: null,
      conflicts: [],
      lastSavedAt: null,
      updatedAt: stored.updatedAt || Date.now(),
    };
    const changes = computeSessionChanges(restored, names, teamMembers);
    restored.changedCount = changes.length;
    if (changes.length === 0) {
      restored.hasUnsavedEdits = false;
      restored.status = SAVE_STATUS.EDITING;
    }
    memorySessions.set(rosterMonth, restored);
    return restored;
  }

  const freshGrid = typeof initialGridFactory === 'function' ? deepCloneGrid(initialGridFactory()) : {};
  const session = {
    rosterMonth,
    editedGrid: freshGrid,
    baseCellsObj: serializeCellsMap(serverCellsMap),
    baseChecksum: serverChecksum || '',
    undoStack: [],
    redoStack: [],
    pendingOperationId: null,
    hasUnsavedEdits: false,
    changedCount: 0,
    status: existingMem?.status === SAVE_STATUS.SAVED ? SAVE_STATUS.SAVED : SAVE_STATUS.EDITING,
    lastError: null,
    conflicts: [],
    lastSavedAt: existingMem?.lastSavedAt || null,
    updatedAt: Date.now(),
  };
  memorySessions.set(rosterMonth, session);
  return session;
}

/**
 * Hydrates from IndexedDB if memory/localStorage had no draft for rosterMonth.
 */
export async function hydrateMonthStagingFromIdb(rosterMonth, names = [], teamMembers = []) {
  const existingMem = memorySessions.get(rosterMonth);
  if (existingMem && existingMem.hasUnsavedEdits) return existingMem;

  const idbDraft = await readIdbMonthDraft(rosterMonth);
  if (!idbDraft || !idbDraft.hasUnsavedEdits || !idbDraft.editedGrid) return null;

  const restored = {
    rosterMonth,
    editedGrid: deepCloneGrid(idbDraft.editedGrid),
    baseCellsObj: idbDraft.baseCellsObj || {},
    baseChecksum: idbDraft.baseChecksum || '',
    undoStack: Array.isArray(idbDraft.undoStack) ? idbDraft.undoStack : [],
    redoStack: Array.isArray(idbDraft.redoStack) ? idbDraft.redoStack : [],
    pendingOperationId: idbDraft.pendingOperationId || generateOperationId(rosterMonth),
    hasUnsavedEdits: true,
    status: SAVE_STATUS.UNSAVED_CHANGES,
    lastError: null,
    conflicts: [],
    lastSavedAt: null,
    updatedAt: idbDraft.updatedAt || Date.now(),
  };
  const changes = computeSessionChanges(restored, names, teamMembers);
  restored.changedCount = changes.length;
  memorySessions.set(rosterMonth, restored);
  writeLocalStorage(rosterMonth, restored);
  notifyListeners(rosterMonth);
  return restored;
}

/**
 *Peek at whether a month has unsaved local edits without mutating state.
 */
export function hasUnsavedMonthEdits(rosterMonth) {
  const mem = memorySessions.get(rosterMonth);
  if (mem) return Boolean(mem.hasUnsavedEdits && mem.changedCount > 0);
  const stored = readLocalStorage(rosterMonth);
  return Boolean(stored && stored.hasUnsavedEdits);
}

export function getMonthSessionSnapshot(rosterMonth) {
  return memorySessions.get(rosterMonth) || null;
}

/**
 * Applies a local update to editedGrid for rosterMonth (zero network calls!).
 * Records Undo step, clears Redo stack, recomputes changedCount, and persists locally.
 */
export function applyLocalGridUpdate({
  rosterMonth,
  updater,
  names = [],
  teamMembers = [],
  serverCellsMap = null,
  serverChecksum = '',
}) {
  let session = memorySessions.get(rosterMonth);
  if (!session) {
    session = {
      rosterMonth,
      editedGrid: {},
      baseCellsObj: serverCellsMap ? serializeCellsMap(serverCellsMap) : {},
      baseChecksum: serverChecksum || '',
      undoStack: [],
      redoStack: [],
      pendingOperationId: null,
      hasUnsavedEdits: false,
      changedCount: 0,
      status: SAVE_STATUS.EDITING,
      lastError: null,
      conflicts: [],
      lastSavedAt: null,
      updatedAt: Date.now(),
    };
  }

  const prevGrid = deepCloneGrid(session.editedGrid);
  const rawNextGrid = typeof updater === 'function' ? updater(deepCloneGrid(session.editedGrid)) : updater;
  const nextGrid = deepCloneGrid(rawNextGrid);

  // Avoid pushing no-op history frames if grid didn't change
  if (JSON.stringify(prevGrid) === JSON.stringify(nextGrid)) {
    return session;
  }

  const nextUndo = [...session.undoStack, prevGrid].slice(-MAX_HISTORY);
  const updatedSession = {
    ...session,
    editedGrid: nextGrid,
    undoStack: nextUndo,
    redoStack: [],
    updatedAt: Date.now(),
    lastError: null,
    conflicts: [],
  };

  const changes = computeSessionChanges(updatedSession, names, teamMembers);
  updatedSession.changedCount = changes.length;
  updatedSession.hasUnsavedEdits = changes.length > 0;
  updatedSession.pendingOperationId = updatedSession.hasUnsavedEdits
    ? (session.pendingOperationId || generateOperationId(rosterMonth))
    : null;
  updatedSession.status = updatedSession.hasUnsavedEdits
    ? SAVE_STATUS.UNSAVED_CHANGES
    : SAVE_STATUS.EDITING;

  memorySessions.set(rosterMonth, updatedSession);
  persistRecord(rosterMonth, updatedSession);
  notifyListeners(rosterMonth);
  return updatedSession;
}

/**
 * Undo the most recent local edit for rosterMonth.
 */
export function undoLocalEdit(rosterMonth, names = [], teamMembers = []) {
  const session = memorySessions.get(rosterMonth);
  if (!session || session.undoStack.length === 0) return session || null;

  const nextUndo = [...session.undoStack];
  const previousGrid = nextUndo.pop();
  const nextRedo = [...session.redoStack, deepCloneGrid(session.editedGrid)].slice(-MAX_HISTORY);

  const updatedSession = {
    ...session,
    editedGrid: deepCloneGrid(previousGrid),
    undoStack: nextUndo,
    redoStack: nextRedo,
    updatedAt: Date.now(),
    lastError: null,
    conflicts: [],
  };

  const changes = computeSessionChanges(updatedSession, names, teamMembers);
  updatedSession.changedCount = changes.length;
  updatedSession.hasUnsavedEdits = changes.length > 0;
  updatedSession.pendingOperationId = updatedSession.hasUnsavedEdits
    ? generateOperationId(rosterMonth)
    : null;
  updatedSession.status = updatedSession.hasUnsavedEdits
    ? SAVE_STATUS.UNSAVED_CHANGES
    : SAVE_STATUS.EDITING;

  memorySessions.set(rosterMonth, updatedSession);
  persistRecord(rosterMonth, updatedSession);
  notifyListeners(rosterMonth);
  return updatedSession;
}

/**
 * Redo the most recently undone local edit for rosterMonth.
 */
export function redoLocalEdit(rosterMonth, names = [], teamMembers = []) {
  const session = memorySessions.get(rosterMonth);
  if (!session || session.redoStack.length === 0) return session || null;

  const nextRedo = [...session.redoStack];
  const restoredGrid = nextRedo.pop();
  const nextUndo = [...session.undoStack, deepCloneGrid(session.editedGrid)].slice(-MAX_HISTORY);

  const updatedSession = {
    ...session,
    editedGrid: deepCloneGrid(restoredGrid),
    undoStack: nextUndo,
    redoStack: nextRedo,
    updatedAt: Date.now(),
    lastError: null,
    conflicts: [],
  };

  const changes = computeSessionChanges(updatedSession, names, teamMembers);
  updatedSession.changedCount = changes.length;
  updatedSession.hasUnsavedEdits = changes.length > 0;
  updatedSession.pendingOperationId = updatedSession.hasUnsavedEdits
    ? generateOperationId(rosterMonth)
    : null;
  updatedSession.status = updatedSession.hasUnsavedEdits
    ? SAVE_STATUS.UNSAVED_CHANGES
    : SAVE_STATUS.EDITING;

  memorySessions.set(rosterMonth, updatedSession);
  persistRecord(rosterMonth, updatedSession);
  notifyListeners(rosterMonth);
  return updatedSession;
}

/**
 * Detects whether another device/session saved conflicting changes on the server
 * since local editing started.
 */
export function detectConcurrentSaveConflicts({
  rosterMonth,
  latestServerCellsMap,
  mode, // 'DRAFT' | 'AMEND'
  names = [],
  teamMembers = [],
}) {
  const session = memorySessions.get(rosterMonth);
  if (!session || !session.hasUnsavedEdits) {
    return { hasConflict: false, conflicts: [], changedCells: [] };
  }

  const baseCellsMap = deserializeCellsObject(session.baseCellsObj);
  const editedCellsMap = buildCellsMapFromEditedGrid({
    editedGrid: session.editedGrid,
    rosterMonth,
    names,
    teamMembers,
    baseCellsMap,
  });

  const changedCells = diffBaselineAndEditedCells({
    baseCellsMap,
    editedCellsMap,
    rosterMonth,
  });

  const conflicts = [];
  const changedKeysSet = new Set(changedCells.map((c) => c.cellKey));

  // 1. Direct cell conflicts (any cell locally modified whose server state drifted from baseSnapshot)
  for (const edit of changedCells) {
    const serverCell = latestServerCellsMap.get(edit.cellKey);
    const serverVal = String(serverCell?.effectiveValue ?? serverCell?.value ?? '').trim();
    const baseVal = String(edit.previousValue || '').trim();
    const localVal = String(edit.newValue || '').trim();

    if (
      normalizeShiftComparison(serverVal) !== normalizeShiftComparison(baseVal) &&
      normalizeShiftComparison(serverVal) !== normalizeShiftComparison(localVal)
    ) {
      conflicts.push({
        cellKey: edit.cellKey,
        date: edit.date,
        field: edit.field,
        staffName: edit.staffName,
        baseValue: baseVal || '(blank)',
        serverValue: serverVal || '(blank)',
        localValue: localVal || '(blank)',
        reason: 'CELL_MODIFIED_CONCURRENTLY',
      });
    }
  }

  // 2. In DRAFT mode (which replaces the target month in MasterRoster), also check if ANY other cell
  // in the month changed on the server so we never silently overwrite another device's new shift.
  if (mode === 'DRAFT') {
    const allMonthKeys = new Set([...baseCellsMap.keys(), ...latestServerCellsMap.keys()]);
    for (const cellKey of Array.from(allMonthKeys).sort()) {
      if (changedKeysSet.has(cellKey)) continue;
      const baseEntry = baseCellsMap.get(cellKey);
      const srvEntry = latestServerCellsMap.get(cellKey);
      const date = srvEntry?.date || baseEntry?.date || cellKey.split('|')[1] || '';
      if (!date.startsWith(rosterMonth)) continue;

      const baseVal = String(baseEntry?.effectiveValue ?? baseEntry?.value ?? '').trim();
      const srvVal = String(srvEntry?.effectiveValue ?? srvEntry?.value ?? '').trim();

      if (normalizeShiftComparison(baseVal) !== normalizeShiftComparison(srvVal)) {
        const meta = srvEntry || baseEntry;
        conflicts.push({
          cellKey,
          date,
          field: meta?.field || 'MO_SHIFT',
          staffName: meta?.staffName || cellKey,
          baseValue: baseVal || '(blank)',
          serverValue: srvVal || '(blank)',
          localValue: baseVal || '(blank)',
          reason: 'MONTH_BASELINE_DRIFTED',
        });
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    changedCells,
  };
}

/**
 * Rebases local changedCells onto a freshly fetched server grid and baseline so the Admin can
 * intentionally resolve a conflict without losing their edits or clobbering non-overlapping server updates.
 */
export function rebaseLocalEditsOntoServer({
  rosterMonth,
  latestServerGrid,
  latestServerCellsMap,
  latestServerChecksum,
  names = [],
  teamMembers = [],
}) {
  const session = memorySessions.get(rosterMonth);
  if (!session) return null;

  const changedCells = computeSessionChanges(session, names, teamMembers);
  const rebasedGrid = deepCloneGrid(latestServerGrid);

  for (const edit of changedCells) {
    const { date, field, staffName, staffKey, newValue } = edit;
    if (!rebasedGrid[date]) {
      rebasedGrid[date] = { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' };
    }
    if (field === 'EP_OFFICE_HOUR' || field === 'EP_ONCALL') {
      rebasedGrid[date][field] = newValue;
    } else {
      const normTargetKey = normalizeForComparison(staffKey);
      const normTargetName = normalizeForComparison(mapName(staffName));
      // Remove staffKey / staffName from all MO shift keys on that date, then add to newValue shift(s)
      for (const sKey of Object.keys(rebasedGrid[date])) {
        if (sKey === 'EP_OFFICE_HOUR' || sKey === 'EP_ONCALL') continue;
        const filtered = String(rebasedGrid[date][sKey] || '')
          .split(/[,\n]+/)
          .map((n) => n.trim())
          .filter((n) => {
            if (!n) return false;
            const normCand = normalizeForComparison(mapName(n));
            if (normCand === normTargetKey || normCand === normTargetName) return false;
            const resolvedCand = resolveStaffIdentity(n, n, teamMembers).staffKey;
            return normalizeForComparison(resolvedCand) !== normTargetKey;
          });
        rebasedGrid[date][sKey] = filtered.join(', ');
      }
      if (newValue) {
        const shifts = newValue.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        for (const sh of shifts) {
          const cur = String(rebasedGrid[date][sh] || '')
            .split(/[,\n]+/)
            .map((n) => n.trim())
            .filter(Boolean);
          cur.push(staffName);
          rebasedGrid[date][sh] = cur.join(', ');
        }
      }
    }
  }

  const nextSession = {
    ...session,
    editedGrid: rebasedGrid,
    baseCellsObj: serializeCellsMap(latestServerCellsMap),
    baseChecksum: latestServerChecksum || '',
    pendingOperationId: generateOperationId(rosterMonth),
    conflicts: [],
    lastError: null,
  };
  const nextChanges = computeSessionChanges(nextSession, names, teamMembers);
  nextSession.changedCount = nextChanges.length;
  nextSession.hasUnsavedEdits = nextChanges.length > 0;
  nextSession.status = nextSession.hasUnsavedEdits ? SAVE_STATUS.UNSAVED_CHANGES : SAVE_STATUS.EDITING;

  memorySessions.set(rosterMonth, nextSession);
  persistRecord(rosterMonth, nextSession);
  notifyListeners(rosterMonth);
  return nextSession;
}

export function markMonthSaving(rosterMonth) {
  const session = memorySessions.get(rosterMonth);
  if (!session) return null;
  const updated = {
    ...session,
    status: SAVE_STATUS.SAVING,
    lastError: null,
    conflicts: [],
  };
  memorySessions.set(rosterMonth, updated);
  notifyListeners(rosterMonth);
  return updated;
}

export function markMonthConflict(rosterMonth, conflicts = [], errorMessage = '') {
  const session = memorySessions.get(rosterMonth);
  if (!session) return null;
  const updated = {
    ...session,
    status: SAVE_STATUS.CONFLICT,
    conflicts,
    lastError: errorMessage || 'Server roster was updated by another session since you started editing.',
  };
  memorySessions.set(rosterMonth, updated);
  notifyListeners(rosterMonth);
  return updated;
}

export function markMonthSaveFailed(rosterMonth, errorMessage) {
  const session = memorySessions.get(rosterMonth);
  if (!session) return null;
  const updated = {
    ...session,
    status: SAVE_STATUS.SAVE_FAILED,
    lastError: errorMessage || 'Failed to save changes. Your local edits are preserved.',
  };
  memorySessions.set(rosterMonth, updated);
  persistRecord(rosterMonth, updated);
  notifyListeners(rosterMonth);
  return updated;
}

/**
 * Clears confirmed staged edits after authoritative server save confirmation,
 * advancing the baseline to the newly confirmed server state.
 */
export function markMonthSaveConfirmed({
  rosterMonth,
  confirmedGrid,
  confirmedCellsMap,
  confirmedChecksum,
}) {
  const updated = {
    rosterMonth,
    editedGrid: deepCloneGrid(confirmedGrid),
    baseCellsObj: serializeCellsMap(confirmedCellsMap),
    baseChecksum: confirmedChecksum || '',
    undoStack: [],
    redoStack: [],
    pendingOperationId: null,
    hasUnsavedEdits: false,
    changedCount: 0,
    status: SAVE_STATUS.SAVED,
    lastError: null,
    conflicts: [],
    lastSavedAt: new Date().toISOString(),
    updatedAt: Date.now(),
  };
  memorySessions.set(rosterMonth, updated);
  persistRecord(rosterMonth, updated); // Removes from localStorage / IndexedDB since hasUnsavedEdits === false
  notifyListeners(rosterMonth);
  return updated;
}

/**
 * Discards all pending local edits for a month and resets to server baseline.
 */
export function discardMonthStaging({
  rosterMonth,
  serverGrid,
  serverCellsMap,
  serverChecksum,
}) {
  const reset = {
    rosterMonth,
    editedGrid: deepCloneGrid(serverGrid || {}),
    baseCellsObj: serializeCellsMap(serverCellsMap),
    baseChecksum: serverChecksum || '',
    undoStack: [],
    redoStack: [],
    pendingOperationId: null,
    hasUnsavedEdits: false,
    changedCount: 0,
    status: SAVE_STATUS.EDITING,
    lastError: null,
    conflicts: [],
    lastSavedAt: null,
    updatedAt: Date.now(),
  };
  memorySessions.set(rosterMonth, reset);
  persistRecord(rosterMonth, null);
  notifyListeners(rosterMonth);
  return reset;
}

/**
 * Clears all in-memory staging sessions (used in tests or full reset; note persistent storage
 * is only cleared if clearStorage=true).
 */
export function resetAllMemoryStaging({ clearStorage = false } = {}) {
  if (clearStorage && typeof globalThis.localStorage !== 'undefined') {
    for (const monthKey of memorySessions.keys()) {
      try {
        globalThis.localStorage.removeItem(STORAGE_PREFIX + monthKey);
      } catch (_) {}
    }
  }
  memorySessions.clear();
}
