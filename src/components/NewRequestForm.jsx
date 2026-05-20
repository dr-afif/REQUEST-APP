import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';

const DAILY_LIMIT = 3;

function getNextMonthDefaultDate() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return toIsoDate(nextMonth);
}

export default function NewRequestForm({
  selectedName,
  onSubmit,
  isSubmitting,
  initialValues,
  requests = [],
  shiftTypes = [],
  limitGroups = [],
  shiftBlocks = [],
}) {
  const availableShiftTypes = useMemo(() => {
    if (shiftTypes.length === 0) return ['AM', 'PM', 'ON', 'OFF', 'AL', 'HKA', 'GHKA', 'COURSE']; // fallback
    const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
    return shiftTypes
      .filter((st) => isAdmin || st.IsPublic)
      .map((st) => st.Name);
  }, [shiftTypes, selectedName]);

  const limitGroupById = useMemo(() => {
    return limitGroups.reduce((acc, group) => {
      acc[group.ID] = group;
      return acc;
    }, {});
  }, [limitGroups]);

  const limitGroupIdByShiftType = useMemo(() => {
    return shiftTypes.reduce((acc, st) => {
      if (st.GroupID) {
        acc[st.Name.toUpperCase()] = st.GroupID;
      }
      return acc;
    }, {});
  }, [shiftTypes]);

  const limitOverridesByDateAndGroup = useMemo(() => {
    return shiftBlocks.reduce((acc, block) => {
      if (!acc[block.Date]) acc[block.Date] = {};
      acc[block.Date][block.ShiftType] = block.MaxSlots; // ShiftType in shiftBlocks is actually GroupID
      return acc;
    }, {});
  }, [shiftBlocks]);

  const usageByDateAndGroup = useMemo(() => {
    return (requests ?? []).reduce((acc, request) => {
      const status = (request?.status ?? '').toLowerCase();
      if (status && status !== 'active') return acc;
      
      const requestType = (request?.request ?? '').toString().trim().toUpperCase();
      const groupId = limitGroupIdByShiftType[requestType];
      if (!groupId) return acc; // unlimited

      const dateKey = toIsoDate(request?.date);
      if (!dateKey) return acc;

      if (!acc[dateKey]) acc[dateKey] = {};
      acc[dateKey][groupId] = (acc[dateKey][groupId] ?? 0) + 1;
      return acc;
    }, {});
  }, [requests, limitGroupIdByShiftType]);

  const getDefaultState = () => ({
    date: getNextMonthDefaultDate() ?? '',
    request: availableShiftTypes[0] ?? 'AM',
    comment: '',
  });

  const [formState, setFormState] = useState(getDefaultState);
  const [validationError, setValidationError] = useState('');

  const isReady = useMemo(() => Boolean(selectedName), [selectedName]);

  useEffect(() => {
    if (initialValues) {
      setFormState({
        date: initialValues.date ? initialValues.date.slice(0, 10) : '',
        request: initialValues.request ?? availableShiftTypes[0],
        comment: initialValues.comment ?? '',
      });
    } else {
      setFormState((prev) => ({
        date: getNextMonthDefaultDate() ?? '',
        request: availableShiftTypes.includes(prev.request) ? prev.request : availableShiftTypes[0],
        comment: '',
      }));
    }
  }, [initialValues, availableShiftTypes]);

  useEffect(() => {
    if (!selectedName) {
      setFormState(getDefaultState());
    }
  }, [selectedName]);

  const selectedDateKey = toIsoDate(formState.date);

  const getLimitStatusForType = (type, date) => {
    const groupId = limitGroupIdByShiftType[(type || '').toUpperCase()];
    if (!groupId) return { isLimited: false }; 
    
    const group = limitGroupById[groupId];
    if (!group) return { isLimited: false };

    // Check if there is an override
    const override = limitOverridesByDateAndGroup[date]?.[groupId];
    const limit = override !== undefined ? override : group.DefaultLimit;

    // Current usage
    const usage = usageByDateAndGroup[date]?.[groupId] ?? 0;
    
    // Adjust if editing the same type
    let effectiveUsage = usage;
    if (initialValues?.id) {
       const editingDateKey = toIsoDate(initialValues?.date);
       const editingType = (initialValues?.request ?? '').toUpperCase();
       const editingGroupId = limitGroupIdByShiftType[editingType];
       if (editingDateKey === date && editingGroupId === groupId) {
         effectiveUsage = Math.max(0, usage - 1);
       }
    }

    return {
      isLimited: true,
      groupName: group.GroupName,
      limit,
      usage: effectiveUsage,
      isAtLimit: effectiveUsage >= limit
    };
  };

  const selectedTypeStatus = getLimitStatusForType(formState.request, selectedDateKey);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValidationError('');
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isReady || !formState.date || !formState.request) return;

    const normalizedDate = toIsoDate(formState.date) ?? formState.date;
    const limitStatus = getLimitStatusForType(formState.request, normalizedDate);

    if (limitStatus.isLimited && limitStatus.isAtLimit) {
      setValidationError(
        `Limit reached for group '${limitStatus.groupName}' (${limitStatus.limit} slots) on this date.`
      );
      return;
    }

    onSubmit?.({
      name: selectedName,
      date: formState.date,
      request: formState.request,
      comment: formState.comment,
      id: initialValues?.id,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <fieldset className="flex flex-col gap-4" disabled={isSubmitting || !isReady}>
        <legend className="text-base font-semibold text-slate-900">
          {initialValues?.id ? 'Update request' : 'New request'}
        </legend>

        <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span className="font-medium text-slate-700">Team member: </span>
          <span className="text-slate-900">
            {selectedName || 'Select a team member above to start a request'}
          </span>
        </div>

        <label className="text-sm font-medium text-slate-700">
          Date
          <input
            type="date"
            name="date"
            value={formState.date}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            required
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Request type
          <select
            name="request"
            value={formState.request}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:text-slate-400"
          >
            {availableShiftTypes.map((type) => {
              const limitStatus = getLimitStatusForType(type, selectedDateKey);
              return (
                <option
                  key={type}
                  value={type}
                  disabled={limitStatus.isLimited && limitStatus.isAtLimit}
                >
                  {type} {limitStatus.isLimited && limitStatus.isAtLimit ? '(Full)' : ''}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {selectedDateKey && selectedTypeStatus.isLimited ? (
              <>
                {selectedTypeStatus.usage}/{selectedTypeStatus.limit} requests for group '{selectedTypeStatus.groupName}' on this date.
                {selectedTypeStatus.isAtLimit ? ' Selection capped.' : ''}
              </>
            ) : (
              selectedTypeStatus.isLimited ? `Group '${selectedTypeStatus.groupName}' is subject to limits.` : 'This shift type is unlimited.'
            )}
          </p>
        </label>

        <label className="text-sm font-medium text-slate-700">
          Comment (optional)
          <textarea
            name="comment"
            value={formState.comment}
            onChange={handleChange}
            rows={3}
            placeholder="Add any context for this request"
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>

        <button
          type="submit"
          className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {isSubmitting ? 'Saving...' : 'Save request'}
        </button>

        {validationError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {validationError}
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
