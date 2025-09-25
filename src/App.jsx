import { useEffect, useMemo, useState } from 'react';
import CalendarView from './components/CalendarView';
import UserSection from './components/UserSection';
import { deleteRequest, fetchAllRequests, fetchTeamMembers, submitRequest, updateRequest } from './api';
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

      return {
        id: pick('id', 'ID', 'Id'),
        timestamp: pick('timestamp', 'Timestamp'),
        name: pick('name', 'Name') ?? '',
        date: pick('date', 'Date') ?? '',
        day: pick('day', 'Day') ?? '',
        request: pick('request', 'Request') ?? '',
        status: pick('status', 'Status') ?? '',
        comment: pick('comment', 'Comment') ?? '',
      };
    }

    return entry;
  });
}

export default function App() {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedName, setSelectedName] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamMembersError, setTeamMembersError] = useState('');
  const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadTeamMembers = async () => {
      try {
        setTeamMembersError('');
        const data = await fetchTeamMembers();
        if (!isMounted) return;
        const names = Array.isArray(data)
          ? data
              .map((entry) => (typeof entry === 'string' ? entry : entry?.name ?? ''))
              .map((name) => (typeof name === 'string' ? name.trim() : ''))
              .filter(Boolean)
          : [];
        const deduped = Array.from(new Set(names));
        setTeamMembers(deduped);
      } catch (error) {
        if (!isMounted) return;
        setTeamMembersError(error.message ?? 'Could not load team members.');
      } finally {
        if (isMounted) {
          setIsLoadingTeamMembers(false);
        }
      }
    };

    loadTeamMembers();

    return () => {
      isMounted = false;
    };
  }, []);

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

  useEffect(() => {
    if (!selectedName) return;

    const hasSelected = rosterNames.some((name) =>
      normalizeForComparison(name) === normalizeForComparison(selectedName)
    );

    if (!hasSelected) {
      setSelectedName('');
    }
  }, [rosterNames, selectedName]);

  const handleSubmitRequest = async ({ name, date, request, id, comment }) => {
    const isoDate = toIsoDate(date);
    const normalizedDate = isoDate ?? date;
    const sanitizedComment = typeof comment === 'string' ? comment.trim() : '';

    const payload = {
      name,
      date: normalizedDate,
      day: normalizedDate ? toWeekdayName(normalizedDate) : '',
      request,
      comment: sanitizedComment,
    };

    if (id) {
      await updateRequest(id, payload);
    } else {
      await submitRequest(payload);
    }

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
          namesError={teamMembersError}
          isLoadingNames={isLoadingTeamMembers}
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
