import { useEffect, useState } from 'react';

const REQUEST_TYPES = ['AM', 'PM', 'ON', 'OFF', 'AL', 'GHKA', 'COURSE'];

export default function NewRequestForm({
  selectedName,
  onSubmit,
  isSubmitting,
  initialValues,
}) {
  const [formState, setFormState] = useState({
    date: '',
    request: REQUEST_TYPES[0],
    name: '',
  });

  useEffect(() => {
    setFormState((prev) => ({
      ...prev,
      name: selectedName ?? '',
    }));
  }, [selectedName]);

  useEffect(() => {
    if (initialValues) {
      setFormState({
        name: initialValues.name ?? selectedName ?? '',
        date: initialValues.date ? initialValues.date.slice(0, 10) : '',
        request: initialValues.request ?? REQUEST_TYPES[0],
      });
    }
  }, [initialValues, selectedName]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!formState.name || !formState.date || !formState.request) return;

    onSubmit?.({
      name: formState.name,
      date: formState.date,
      request: formState.request,
      id: initialValues?.id,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <fieldset className="flex flex-col gap-4" disabled={isSubmitting}>
        <legend className="text-base font-semibold text-slate-900">
          {initialValues ? 'Update request' : 'New request'}
        </legend>

        <label className="text-sm font-medium text-slate-700">
          Name
          <input
            type="text"
            name="name"
            value={formState.name}
            onChange={handleChange}
            placeholder="Your full name"
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Date
          <input
            type="date"
            name="date"
            value={formState.date}
            onChange={handleChange}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
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
