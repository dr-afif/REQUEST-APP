import { useEffect, useMemo, useState } from 'react';

const REQUEST_TYPES = ['AM', 'PM', 'ON', 'OFF', 'AL', 'HKA', 'GHKA', 'COURSE'];
const INITIAL_STATE = { date: '', request: REQUEST_TYPES[0], comment: '' };

export default function NewRequestForm({
  selectedName,
  onSubmit,
  isSubmitting,
  initialValues,
}) {
  const [formState, setFormState] = useState(INITIAL_STATE);

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
        date: '',
        request: REQUEST_TYPES.includes(prev.request) ? prev.request : REQUEST_TYPES[0],
        comment: '',
      }));
    }
  }, [initialValues]);

  useEffect(() => {
    if (!selectedName) {
      setFormState(INITIAL_STATE);
    }
  }, [selectedName]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isReady || !formState.date || !formState.request) return;

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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
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
      </fieldset>
    </form>
  );
}