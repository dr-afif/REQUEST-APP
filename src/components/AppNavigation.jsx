import { useMemo } from 'react';
import { normalizeForComparison } from '../utils/normalise';
import { APP_ICONS } from '../constants/icons';

export default function AppNavigation({
  currentPage,
  onPageChange,
  selectedName,
  onSelectName,
  names = [],
  syncStatus = 'connected',
  onRefresh,
}) {
  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
  const isGuest = selectedName?.trim().toLowerCase() === 'guest';

  const statusColor = useMemo(() => {
    switch (syncStatus) {
      case 'loading':
        return 'bg-amber-400 animate-pulse';
      case 'error':
        return 'bg-rose-500';
      case 'connected':
      default:
        return 'bg-emerald-500';
    }
  }, [syncStatus]);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: APP_ICONS.dashboard },
    { id: 'roster', label: 'Full Roster', icon: APP_ICONS.roster },
    { id: 'requests', label: 'Request Panel', icon: APP_ICONS.requests },
    { id: 'updates', label: 'Updates', icon: APP_ICONS.updates },
    ...(isAdmin ? [
      { id: 'summary', label: 'Summary', icon: APP_ICONS.analytics },
      { id: 'ph-tracker', label: 'PH Tracker', icon: APP_ICONS.phTracker },
      { id: 'admin', label: 'Admin Panel', icon: APP_ICONS.admin }
    ] : []),
  ];

  return (
    <>
      {/* ========================================================================= */}
      {/* 🖥️ DESKTOP SIDE RAIL NAVIGATION (hidden on mobile/tablet)                   */}
      {/* ========================================================================= */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200/80 p-6 z-40 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        {/* Brand Header */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => onPageChange('dashboard')} role="button">
          <div className="flex shrink-0 h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-600 text-white font-bold text-base shadow-md shadow-indigo-100">
            ED
          </div>
          <div>
            <span className="whitespace-nowrap text-lg font-bold bg-gradient-to-r from-teal-600 to-indigo-700 bg-clip-text text-transparent">
              ED Roster
            </span>
            <div className="flex whitespace-nowrap items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              <span className={`inline-block shrink-0 h-2 w-2 rounded-full ${statusColor}`} />
              <span>Sync: {syncStatus}</span>
            </div>
          </div>
        </div>

        {/* Sync Controls / Refresh Row */}
        <div className="mt-4 flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Google Sheets</span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs shadow-sm transition hover:bg-slate-50 active:scale-95 cursor-pointer text-slate-600 hover:text-indigo-600"
            onClick={onRefresh}
            title="Refresh database"
          >
            <APP_ICONS.refresh className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Navigation Menu Links */}
        <nav className="flex-grow flex flex-col gap-1.5 mt-8">
          {navItems.map((item) => {
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-50 to-indigo-100/50 text-indigo-700 shadow-sm ring-1 ring-indigo-100/60'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600" />}
              </button>
            );
          })}
        </nav>

        {/* User Account / Profile Footer */}
        <div className="border-t border-slate-100 pt-6">
          <div className="rounded-2xl bg-slate-50 p-4 border border-slate-150 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-500">
              <APP_ICONS.user className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Active User</span>
            </div>

            {isAdmin ? (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <select
                    id="member-select-desktop"
                    value={selectedName}
                    onChange={(e) => onSelectName(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-semibold text-slate-700 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 cursor-pointer"
                  >
                    <option value="Admin">Admin</option>
                    {names.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                    ▼
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectName('')}
                  className="w-full flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 text-xs font-bold text-rose-600 shadow-xs transition hover:bg-rose-100/80 active:scale-95 cursor-pointer"
                >
                  <APP_ICONS.logout className="w-3.5 h-3.5" /> Exit Admin
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-xs truncate flex items-center gap-2">
                  {isGuest && <APP_ICONS.info className="w-4 h-4 text-slate-400" />}
                  {isGuest ? 'Read-Only Guest' : selectedName}
                </div>
                <button
                  type="button"
                  onClick={() => onSelectName('')}
                  className="w-full flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-150 bg-rose-50 px-3 text-xs font-bold text-rose-600 shadow-xs transition hover:bg-rose-100/80 active:scale-95 cursor-pointer"
                >
                  <APP_ICONS.logout className="w-3.5 h-3.5" /> Log Out / Exit
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 📱 MOBILE TOP HEADER BAR (hidden on desktop)                                */}
      {/* ========================================================================= */}
      <header className="flex lg:hidden sticky top-0 w-full h-14 items-center justify-between px-4 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-xs">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => onPageChange('dashboard')} role="button">
          <div className="flex shrink-0 h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-teal-500 to-indigo-600 text-white font-bold text-xs shadow-xs">
            ED
          </div>
          <div>
            <span className="whitespace-nowrap text-sm font-bold bg-gradient-to-r from-teal-600 to-indigo-700 bg-clip-text text-transparent">
              ED Roster
            </span>
            <div className="flex items-center gap-1 text-[8px] font-semibold text-slate-400 uppercase tracking-wider">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor}`} />
              <span>{syncStatus}</span>
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          {/* User Name Pill */}
          <span className="max-w-[100px] truncate text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1 flex items-center gap-1">
            {isAdmin && <APP_ICONS.adminBadge className="w-3 h-3 text-indigo-600" />}
            {isAdmin ? 'Admin' : isGuest ? 'Guest' : selectedName}
          </span>

          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs shadow-xs active:scale-95 cursor-pointer"
            onClick={onRefresh}
            title="Refresh database"
          >
            <APP_ICONS.refresh className="w-3.5 h-3.5 text-slate-600 hover:text-indigo-600" />
          </button>

          <button
            type="button"
            onClick={() => onSelectName('')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-xs font-bold text-rose-600 shadow-xs active:scale-95 cursor-pointer"
            title="Log Out"
          >
            <APP_ICONS.logout className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 📱 MOBILE BOTTOM TAB NAVIGATION BAR (hidden on desktop)                    */}
      {/* ========================================================================= */}
      <nav className="flex lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200/60 items-center justify-around z-40 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        {navItems.map((item) => {
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPageChange(item.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1.5 text-center transition-all duration-200 cursor-pointer ${
                isActive 
                  ? 'text-indigo-600 scale-105' 
                  : 'text-slate-500 active:scale-95'
              }`}
            >
              <item.icon className={`w-6 h-6 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
              <span className="text-[9px] font-bold mt-1 tracking-tight leading-none">
                {item.label.split(' ')[0]} {/* Grab short first word for label */}
              </span>
              {isActive && <span className="h-1 w-1 rounded-full bg-indigo-600 mt-1" />}
            </button>
          );
        })}
      </nav>
    </>
  );
}
