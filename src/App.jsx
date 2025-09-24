import { useEffect, useMemo, useState } from 'react';
import CalendarView from './components/CalendarView';
import UserSection from './components/UserSection';
import { deleteRequest, fetchAllRequests, submitRequest } from './api';
import { normalizeForComparison, toIsoDate } from './utils/normalise';

const REFRESH_INTERVAL = 60 * 1000; // 1 minute

function adaptRequestsResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.values)) return data.values;
  return [];
}

export default function App() {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedName, setSelectedName] = useState('');
  const [refreshError, setRefreshError] = useState('');

  const refreshRequests = async () => {
    const data = await fetchAllRequests();
    const adapted = adaptRequestsResponse(data);
    setRequests(adapted);
    return adapted;
  };

  useEffect(() => {
    let timeoutId;

    const fetchRequests = async () => {
      try {
        setRefreshError('');
        await refreshRequests();
      } catch (error) {
        setRefreshError(error.message ?? 'Could not load roster data.');
      } finally {
        setIsLoading(false);
        timeoutId = window.setTimeout(fetchRequests, REFRESH_INTERVAL);
      }
    };

    fetchRequests();
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleSubmitRequest = async ({ name, date, request, id }) => {
    const payload = {
      name,
      date: toIsoDate(date) ?? date,
      request,
      previousId: id ?? undefined,
    };

    await submitRequest(payload);
    await refreshRequests();
  };

  const handleDeleteRequest = async ({ id, name }) => {
    if (!id) {
      throw new Error('Missing request ID for deletion.');
    }

    await deleteRequest(id);
    const updated = await refreshRequests();

    const remainingForUser = updated.filter(
      (entry) =>
        normalizeForComparison(entry.name) === normalizeForComparison(name) &&
        entry.status?.toLowerCase() === 'active'
    );

    if (!remainingForUser.length && normalizeForComparison(selectedName) === normalizeForComparison(name)) {
      setSelectedName('');
    }
  };

  const activeRequests = useMemo(() => {
    return requests.filter((request) => request.status?.toLowerCase() === 'active');
  }, [requests]);

  const rosterNames = useMemo(() => {
    const unique = new Set();
    requests.forEach((request) => {
      if (request.name) {
        unique.add(request.name.trim());
      }
    });
    return Array.from(unique);
  }, [requests]);

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-6 md:px-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">RESQ Roster Requests</h1>
          <p className="text-sm text-slate-500 md:text-base">
            Track and update roster change requests backed by Google Sheets.
          </p>
          {refreshError ? (
            <span className="text-xs font-semibold text-rose-600">{refreshError}</span>
          ) : null}
        </header>

        <CalendarView requests={activeRequests} />

        <UserSection
          requests={requests}
          names={rosterNames}
          selectedName={selectedName}
          onSelectName={setSelectedName}
          onSubmitRequest={handleSubmitRequest}
          onDeleteRequest={handleDeleteRequest}
          isLoadingRequests={isLoading}
        />
      </main>
    </div>
  );
}
