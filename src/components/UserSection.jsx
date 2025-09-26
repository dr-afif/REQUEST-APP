import { useMemo, useState } from 'react';
import UserRequests from './UserRequests';
import NewRequestForm from './NewRequestForm';

export default function UserSection({
  requests,
  names,
  namesError,
  isLoadingNames,
  selectedName,
  onSelectName,
  onSubmitRequest,
  onDeleteRequest,
  isLoadingRequests,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [error, setError] = useState('');

  const sortedNames = useMemo(() => {
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [names]);

  const handleSubmit = async (payload) => {
    try {
      setIsSubmitting(true);
      setError('');
      await onSubmitRequest(payload);
      setEditingRequest(null);
    } catch (err) {
      setError(err.message ?? 'Unable to save request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (request) => {
    try {
      setIsSubmitting(true);
      setError('');
      await onDeleteRequest(request);
      if (editingRequest?.id === request.id) {
        setEditingRequest(null);
      }
    } catch (err) {
      setError(err.message ?? 'Unable to delete request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const placeholderLabel = (() => {
    if (isLoadingNames) return 'Loading team members...';
    if (!sortedNames.length) return 'No team members available';
    return 'Select team member...';
  })();

  const disableSelector = isLoadingNames || (!sortedNames.length && !selectedName);

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <label className="flex flex-col text-sm font-medium text-slate-700">
          Your name
          <select
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:text-slate-400"
            value={selectedName}
            onChange={(event) => onSelectName(event.target.value)}
            disabled={disableSelector}
          >
            <option value="">
              {placeholderLabel}
            </option>
            {sortedNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {namesError ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {namesError}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <UserRequests
        requests={requests}
        selectedName={selectedName}
        onEdit={setEditingRequest}
        onDelete={handleDelete}
        isLoading={isLoadingRequests}
      />

      <NewRequestForm
        selectedName={selectedName}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        initialValues={editingRequest}
      />
    </section>
  );
}