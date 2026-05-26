import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';
import {
  buildLimitGroupById,
  buildLimitGroupIdByShiftType,
  buildLimitOverridesByDateAndGroup,
  buildUsageByDateAndGroup,
  getLimitStatusForType as getQuotaLimitStatusForType,
  getMonthlyRequestCount,
  getMonthlyWeekendRequestCount,
} from '../utils/quota';

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
  settings = {},
  names = [],
}) {
  const availableShiftTypes = useMemo(() => {
    if (shiftTypes.length === 0) return ['AM', 'PM', 'ON', 'OFF', 'AL', 'HKA', 'GHKA', 'COURSE']; // fallback
    const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
    return shiftTypes
      .filter((st) => isAdmin || st.IsPublic)
      .map((st) => st.Name);
  }, [shiftTypes, selectedName]);

  const limitGroupById = useMemo(() => {
    return buildLimitGroupById(limitGroups);
  }, [limitGroups]);

  const limitGroupIdByShiftType = useMemo(() => {
    return buildLimitGroupIdByShiftType(shiftTypes);
  }, [shiftTypes]);

  const limitOverridesByDateAndGroup = useMemo(() => {
    return buildLimitOverridesByDateAndGroup(shiftBlocks);
  }, [shiftBlocks]);

  const usageByDateAndGroup = useMemo(() => {
    return buildUsageByDateAndGroup(requests, limitGroupIdByShiftType);
  }, [requests, limitGroupIdByShiftType]);

  const getDefaultState = () => ({
    date: getNextMonthDefaultDate() ?? '',
    request: availableShiftTypes[0] ?? 'AM',
    comment: '',
  });

  const [formState, setFormState] = useState(getDefaultState);
  const [validationError, setValidationError] = useState('');
  const [onBehalfOfName, setOnBehalfOfName] = useState(() => {
    return initialValues?.name || '';
  });

  const isReady = useMemo(() => Boolean(selectedName), [selectedName]);

  useEffect(() => {
    if (initialValues) {
      setFormState({
        date: initialValues.date ? toIsoDate(initialValues.date) : '',
        request: initialValues.request ?? availableShiftTypes[0],
        comment: initialValues.comment ?? '',
      });
      setOnBehalfOfName(initialValues.name || '');
    } else {
      setFormState((prev) => ({
        date: getNextMonthDefaultDate() ?? '',
        request: availableShiftTypes.includes(prev.request) ? prev.request : availableShiftTypes[0],
        comment: '',
      }));
      setOnBehalfOfName('');
    }
  }, [initialValues, availableShiftTypes]);

  useEffect(() => {
    if (!selectedName) {
      setFormState(getDefaultState());
      setOnBehalfOfName('');
    }
  }, [selectedName]);

  const selectedDateKey = toIsoDate(formState.date);

  const getLimitStatusForType = (type, date) => {
    return getQuotaLimitStatusForType({
      type,
      date,
      limitGroupIdByShiftType,
      limitGroupById,
      limitOverridesByDateAndGroup,
      usageByDateAndGroup,
      initialValues,
    });
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

    const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
    const finalName = isAdmin ? onBehalfOfName : selectedName;

    if (!finalName) {
      setValidationError('Please select a team member.');
      return;
    }

    const normalizedDate = toIsoDate(formState.date) ?? formState.date;
    const limitStatus = getLimitStatusForType(formState.request, normalizedDate);

    // 1. Check daily limit (skip if Admin)
    if (!isAdmin && limitStatus.isLimited && limitStatus.isAtLimit) {
      setValidationError(
        `Limit reached for group '${limitStatus.groupName}' (${limitStatus.limit} slots) on this date.`
      );
      return;
    }

    // 2. Check monthly limit (skip if Admin)
    if (!isAdmin) {
      const monthlyCount = getMonthlyRequestCount({
        requests,
        targetName: finalName,
        dateString: normalizedDate,
        initialRequestId: initialValues?.id,
      });
      const monthlyLimit = Number(settings?.monthly_request_limit) || 10;
      if (monthlyCount >= monthlyLimit) {
        setValidationError(
          `Monthly request limit reached for ${finalName} (${monthlyLimit} requests allowed per month).`
        );
        return;
      }
    }

    // 3. Check monthly weekend limit (skip if Admin)
    if (!isAdmin) {
      const d = new Date(normalizedDate);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      
      if (isWeekend) {
        const weekendLimitGroupId = settings?.weekend_limit_group_id || 'ALL';
        let appliesToThisRequest = true;
        
        if (weekendLimitGroupId !== 'ALL') {
           const requestedType = (formState.request || '').trim().toUpperCase();
           const reqGroupId = limitGroupIdByShiftType[requestedType];
           if (reqGroupId !== weekendLimitGroupId) {
             appliesToThisRequest = false;
           }
        }

        if (appliesToThisRequest) {
          const weekendCount = getMonthlyWeekendRequestCount({
            requests,
            targetName: finalName,
            dateString: normalizedDate,
            weekendLimitGroupId,
            limitGroupIdByShiftType,
            initialRequestId: initialValues?.id,
          });
          const weekendLimit = settings?.monthly_weekend_limit !== undefined 
            ? Number(settings.monthly_weekend_limit) 
            : 4; // Default to 4 if not set
          
          if (weekendLimit >= 0 && weekendCount >= weekendLimit) {
            setValidationError(
              `Monthly weekend request limit reached for ${finalName} (${weekendLimit} weekend requests allowed per month for this category).`
            );
            return;
          }
        }
      }
    }

    onSubmit?.({
      name: finalName,
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

        {selectedName?.trim().toLowerCase() === 'admin' ? (
          <label className="text-sm font-medium text-slate-700">
            Submit on behalf of:
            <select
              name="onBehalfOf"
              value={onBehalfOfName}
              onChange={(e) => {
                setValidationError('');
                setOnBehalfOfName(e.target.value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              required
            >
              <option value="">-- Select Team Member --</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Team member: </span>
            <span className="text-slate-900">
              {selectedName || 'Select a team member above to start a request'}
            </span>
          </div>
        )}

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

        {/* 📊 Live Monthly Limit Warning Card (regular users only) */}
        {selectedName?.trim().toLowerCase() !== 'admin' && formState.date && (
          (() => {
            const monthlyLimit = Number(settings?.monthly_request_limit) || 10;
            const monthlyCount = getMonthlyRequestCount({
              requests,
              targetName: selectedName,
              dateString: formState.date,
              initialRequestId: initialValues?.id,
            });
            const isOverLimit = monthlyCount >= monthlyLimit;
            
            let colorClass = 'text-emerald-600 bg-emerald-50/50 border-emerald-100/70';
            if (isOverLimit) {
              colorClass = 'text-rose-600 bg-rose-50 border-rose-100 font-bold';
            } else if (monthlyCount >= monthlyLimit - 2) {
              colorClass = 'text-amber-600 bg-amber-50 border-amber-100';
            }

            let displayMonth = 'this month';
            try {
              displayMonth = new Date(formState.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            } catch (e) {}

            return (
              <div className={`rounded-xl border p-2.5 text-xs ${colorClass} flex items-center justify-between transition-colors duration-300`}>
                <span>Monthly total for {displayMonth}:</span>
                <span>{monthlyCount} / {monthlyLimit} used</span>
              </div>
            );
          })()
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-700">Request type</span>
          <div className="grid grid-cols-4 gap-2">
            {availableShiftTypes.map((type) => {
              const limitStatus = getLimitStatusForType(type, selectedDateKey);
              const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
              const isCapped = !isAdmin && limitStatus.isLimited && limitStatus.isAtLimit;
              const isSelected = formState.request === type;

              let btnClass = "border text-xs font-bold py-2.5 rounded-full text-center transition duration-200 active:scale-[0.96] flex items-center justify-center min-w-0 px-1 truncate cursor-pointer";
              if (isSelected) {
                btnClass += " bg-gradient-to-tr from-indigo-600 to-indigo-700 border-indigo-600 text-white shadow-sm shadow-indigo-100 font-extrabold";
              } else if (isCapped) {
                btnClass += " bg-slate-100 border-slate-200/50 text-slate-400 cursor-not-allowed opacity-60";
              } else {
                btnClass += " bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/50";
              }

              return (
                <button
                  key={type}
                  type="button"
                  disabled={isCapped}
                  title={type + (isCapped ? ' (Full/Capped)' : '')}
                  onClick={() => {
                    setValidationError('');
                    setFormState((prev) => ({ ...prev, request: type }));
                  }}
                  className={btnClass}
                >
                  <span className="truncate">{type}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {selectedDateKey && selectedTypeStatus.isLimited ? (
              <>
                {selectedTypeStatus.usage}/{selectedTypeStatus.limit} requests for group '{selectedTypeStatus.groupName}' on this date.
                {(!selectedName?.trim().toLowerCase() === 'admin' && selectedTypeStatus.isAtLimit) ? ' Selection capped.' : ''}
              </>
            ) : (
              selectedTypeStatus.isLimited ? `Group '${selectedTypeStatus.groupName}' is subject to limits.` : 'This shift type is unlimited.'
            )}
          </p>
        </div>

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
