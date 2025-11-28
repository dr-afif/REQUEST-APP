import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';

const REQUEST_TYPES = ['AM', 'PM', 'ON', 'OFF', 'AL', 'HKA', 'GHKA', 'COURSE'];
const LIMITED_REQUEST_TYPES = ['OFF', 'AL', 'HKA', 'GHKA', 'COURSE'];
const LIMITED_REQUEST_TYPES_SET = new Set(LIMITED_REQUEST_TYPES);
const DAILY_LIMIT = 3;

function getNextMonthDefaultDate() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return toIsoDate(nextMonth);
}

const getDefaultState = () => ({
  date: getNextMonthDefaultDate() ?? '',
  request: REQUEST_TYPES[0],
  comment: '',
});

const LIMITED_TYPES_LABEL = LIMITED_REQUEST_TYPES.join(', ');

function isLimitedType(value) {
  return LIMITED_REQUEST_TYPES_SET.has((value ?? '').toString().trim().toUpperCase());
}

export default function NewRequestForm({
  selectedName,
  onSubmit,
  isSubmitting,
  initialValues,
  requests = [],
}) {
  const [formState, setFormState] = useState(getDefaultState);
  const [validationError, setValidationError] = useState('');

  const isReady = useMemo(() => Boolean(selectedName), [selectedName]);

  useEffect(() => {
    if (initialValues) {
      setFormState({
        date: initialValues.date ? initialValues.date.slice(0, 10) : '',
        request: initialValues.request ?? REQUEST_TYPES[0],
        comment: initialValues.comment ?? '',
      });
    } else {
      setFormState((prev) => ({
        date: getNextMonthDefaultDate() ?? '',
        request: REQUEST_TYPES.includes(prev.request) ? prev.request : REQUEST_TYPES[0],
        comment: '',
      }));
    }
  }, [initialValues]);

  useEffect(() => {
    if (!selectedName) {
      setFormState(getDefaultState());
    }
  }, [selectedName]);

  const limitedCountByDate = useMemo(() => {
    return (requests ?? []).reduce((acc, request) => {
      const requestType = (request?.request ?? '').toString().trim().toUpperCase();
      if (!isLimitedType(requestType)) return acc;

      const status = (request?.status ?? '').toString().toLowerCase();
      if (status && status !== 'active') return acc;

      const dateKey = toIsoDate(request?.date);
      if (!dateKey) return acc;

      acc[dateKey] = (acc[dateKey] ?? 0) + 1;
      return acc;
    }, {});
  }, [requests]);

  const selectedDateKey = toIsoDate(formState.date);
  const editingDateKey = toIsoDate(initialValues?.date);
  const editingIsLimited = isLimitedType(initialValues?.request);

  const getEffectiveLimitedCount = (dateKey) => {
    if (!dateKey) return 0;
    const baseCount = limitedCountByDate[dateKey] ?? 0;
    const isEditingSameDateLimited = Boolean(
      initialValues?.id && editingIsLimited && editingDateKey === dateKey
    );
    if (isEditingSameDateLimited) {
      return Math.max(baseCount - 1, 0);
    }
    return baseCount;
  };

  const selectedDateLimitedCount = getEffectiveLimitedCount(selectedDateKey);
  const isSelectedDateAtLimit = selectedDateLimitedCount >= DAILY_LIMIT;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValidationError('');
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isReady || !formState.date || !formState.request) return;

    const normalizedDate = toIsoDate(formState.date) ?? formState.date;
    const selectionIsLimited = isLimitedType(formState.request);
    const willExceedLimit =
      selectionIsLimited && normalizedDate && getEffectiveLimitedCount(normalizedDate) >= DAILY_LIMIT;

    if (willExceedLimit) {
      setValidationError(
        `Daily limit of ${DAILY_LIMIT} reached for ${LIMITED_TYPES_LABEL} on this date.`
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
          {initialValues ? 'Update request' : 'New request'}
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
            {REQUEST_TYPES.map((type) => (
              <option
                key={type}
                value={type}
                disabled={isSelectedDateAtLimit && isLimitedType(type)}
              >
                {type}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {selectedDateKey ? (
              <>
                {selectedDateLimitedCount}/{DAILY_LIMIT} limited requests ({LIMITED_TYPES_LABEL}) on
                this date.
                {isSelectedDateAtLimit ? ' Selection capped.' : ''}
              </>
            ) : (
              <>Up to {DAILY_LIMIT} total {LIMITED_TYPES_LABEL} requests per day.</>
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
