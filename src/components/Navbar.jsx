import { useState, useMemo } from 'react';
import { normalizeForComparison } from '../utils/normalise';

export default function Navbar({
  currentPage,
  onPageChange,
  selectedName,
  onSelectName,
  names = [],
  syncStatus = 'connected',
  onRefresh,
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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
    { id: 'dashboard', label: '🏠 Dashboard' },
    { id: 'roster', label: '📅 Current Roster' },
    { id: 'requests', label: '📝 Request Panel' },
    { id: 'updates', label: '🔔 Updates' },
    ...(selectedName?.trim().toLowerCase() === 'admin' ? [{ id: 'admin', label: '🔑 Admin Panel' }] : []),
  ];

  const handleNavClick = (id) => {
    onPageChange(id);
    setIsDrawerOpen(false);
  };

  return (
    <>
      <nav className="border-b border-slate-200/60 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
          
          {/* 🏷️ Left: Logo and App Title */}
          <div className="flex items-center gap-2" onClick={() => onPageChange('dashboard')} role="button">
            <div className="flex shrink-0 h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-600 text-white font-bold text-lg shadow-md shadow-indigo-100">
              R
            </div>
            <div>
              <span className="whitespace-nowrap text-lg font-bold bg-gradient-to-r from-teal-600 to-indigo-700 bg-clip-text text-transparent">
                ED Roster
              </span>
              <div className="flex whitespace-nowrap items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                <span className={`inline-block shrink-0 h-2 w-2 rounded-full ${statusColor}`} />
                <span>Google Sync: </span>
                <span className="inline-block w-20">{syncStatus}</span>
              </div>
            </div>
          </div>

          {/* 🖥️ Desktop Navigation Links & Member Profile selector (Visible only on lg and up) */}
          <div className="hidden lg:flex items-center gap-4">
            <div className="flex gap-1">
              {navItems.map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onPageChange(item.id)}
                    className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-50 to-indigo-100/50 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* Member Profile Selector (Desktop) */}
            <div className="flex items-center gap-2 border-l border-slate-200/80 pl-4">
              <label htmlFor="member-select-desktop" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                👤 Member:
              </label>
              <div className="relative">
                <select
                  id="member-select-desktop"
                  value={selectedName}
                  onChange={(e) => onSelectName(e.target.value)}
                  className="appearance-none rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-sm font-semibold text-slate-700 shadow-inner outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100 cursor-pointer"
                >
                  <option value="">-- Guest --</option>
                  <option value="Admin">🔒 Admin</option>
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

              {selectedName && (
                <button
                  type="button"
                  onClick={() => onSelectName('')}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 text-xs font-bold text-rose-600 shadow-sm transition hover:bg-rose-100/80 active:scale-95 cursor-pointer"
                  title="Logout / Switch Profile"
                >
                  <span>🚪</span>
                  <span className="hidden lg:inline">Exit</span>
                </button>
              )}

              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm shadow-sm transition hover:bg-slate-50 cursor-pointer"
                onClick={onRefresh}
                title="Refresh database"
              >
                🔄
              </button>
            </div>
          </div>

          {/* 📱 Mobile Toggle & Hamburger Menu Button (Visible only on mobile/tablet) */}
          <div className="flex lg:hidden items-center gap-2">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm shadow-sm transition hover:bg-slate-50 cursor-pointer"
              onClick={onRefresh}
              title="Refresh database"
            >
              🔄
            </button>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 text-slate-700 transition hover:bg-slate-100/80 active:scale-95 cursor-pointer"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open navigation menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          </div>

        </div>
      </nav>

      {/* 📥 Mobile Sidebar Drawer Overlay (fixed layout) */}
      <div 
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          isDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Dark translucent background */}
        <div 
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
          onClick={() => setIsDrawerOpen(false)}
        />

        {/* Sidebar Panel */}
        <div 
          className={`absolute inset-y-0 right-0 w-80 max-w-[85vw] bg-white p-6 shadow-2xl overflow-y-auto transition-transform duration-300 ease-out transform ${
            isDrawerOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex flex-col min-h-full justify-between gap-6">
            {/* Top Panel Actions */}
            <div>
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-teal-500 to-indigo-600 text-white font-bold text-md shadow-sm">
                    R
                  </div>
                  <span className="text-md font-bold bg-gradient-to-r from-teal-600 to-indigo-700 bg-clip-text text-transparent">
                    RESQ Navigation
                  </span>
                </div>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-700 active:scale-95 cursor-pointer"
                  onClick={() => setIsDrawerOpen(false)}
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>

              {/* Collapsible Vertical Navigation List */}
              <div className="flex flex-col gap-1.5">
                {navItems.map((item) => {
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full text-left rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-50 to-indigo-100/50 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Member Profile Selector Box inside the Drawer at the Bottom */}
            <div className="border-t border-slate-100 pt-6">
              <div className="rounded-2xl bg-slate-50 p-4 border border-slate-150">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">👤</span>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Member Account</span>
                </div>
                
                <div className="relative mb-3">
                  <select
                    id="member-select-mobile"
                    value={selectedName}
                    onChange={(e) => onSelectName(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3.5 pr-8 text-sm font-semibold text-slate-700 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 cursor-pointer"
                  >
                    <option value="">-- Guest --</option>
                    <option value="Admin">🔒 Admin</option>
                    {names.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                    ▼
                  </div>
                </div>

                {selectedName && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectName('');
                      setIsDrawerOpen(false);
                    }}
                    className="w-full flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 text-xs font-bold text-rose-600 shadow-sm transition hover:bg-rose-100/80 active:scale-95 cursor-pointer"
                  >
                    <span>🚪</span>
                    <span>Exit Profile</span>
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
