import { useState, useMemo } from 'react';
import CalendarView from './CalendarView';
import DateDetailPanel from './DateDetailPanel';
import RosterTable from './RosterTable';

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
  masterRoster = [],
  shiftTypes = [],
  limitGroups = [],
  shiftBlocks = [],
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'table'



  const handleDateSelect = (date) => {
    // Clicking the same date again closes the panel
    if (selectedDate && date.toDateString() === selectedDate.toDateString()) {
      setSelectedDate(null);
      setEditingRequest(null);
    } else {
      setSelectedDate(date);
      setEditingRequest(null);
      setError('');
    }
  };

  const handlePanelClose = () => {
    setSelectedDate(null);
    setEditingRequest(null);
    setError('');
  };

  const handleEdit = (request) => {
    setEditingRequest(request);
  };

  const handleSubmit = async (payload) => {
    try {
      setIsSubmitting(true);
      setError('');
      await onSubmitRequest(payload);
      setEditingRequest(null);
      // Keep panel open so user sees the updated calendar
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

  return (
    <section className="flex flex-col gap-4">
      {/* 🧭 Toggle Bar & Layout Selector */}
      <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fadeIn">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">
            📝 Request Panel
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Displaying active requests made by team members.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-150/70 p-1 shadow-inner self-start sm:self-auto ring-1 ring-slate-200">
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
              viewMode === 'calendar'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            📅 Calendar View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
              viewMode === 'table'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            📊 Table View
          </button>
        </div>
      </div>

      {namesError && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {namesError}
        </div>
      )}

      {/* 🎛️ Unified Switch View */}
      {viewMode === 'calendar' ? (
        <CalendarView
          requests={requests}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
        />
      ) : (
        <div className="rounded-3xl border border-slate-150/70 bg-white p-4 shadow-sm sm:p-6">
          <RosterTable
            names={names}
            requests={requests}
          />
        </div>
      )}

      {/* Slide-up / slide-in panel — rendered when a date is selected and in calendar mode */}
      {viewMode === 'calendar' && selectedDate && (
        <DateDetailPanel
          date={selectedDate}
          requests={requests}
          selectedName={selectedName}
          onClose={handlePanelClose}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          editingRequest={editingRequest}
          shiftTypes={shiftTypes}
          limitGroups={limitGroups}
          shiftBlocks={shiftBlocks}
          error={error}
        />
      )}
    </section>
  );
}
