import { useState, useMemo } from 'react';

export default function OnboardingOverlay({ names = [], onSelect, onAdminInit, isLoading }) {
  const [search, setSearch] = useState('');

  const filteredNames = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();
    if (!cleanSearch) return names.slice(0, 5); // show first 5 initially
    return names
      .filter((name) => name.toLowerCase().includes(cleanSearch))
      .slice(0, 5); // limit visible search results
  }, [names, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-tr from-slate-100 via-indigo-50/30 to-slate-200 p-4 backdrop-blur-xl animate-fadeIn overflow-y-auto">
      {/* Dynamic Keyframes */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slideUp {
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/80 p-8 shadow-2xl backdrop-blur-lg animate-slideUp flex flex-col gap-6">
        
        {/* Brand Logo & Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white font-black text-2xl shadow-lg shadow-indigo-200 mb-4 animate-pulse">
            R
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">Welcome to RESQ</h2>
          <p className="mt-1.5 text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Medical Staff Roster Portal
          </p>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed max-w-xs">
            Select your profile name below to personalize your shift duties, customized calendar views, and alert notifications.
          </p>
        </div>

        {/* Profile Selector & Search Box */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              🔎
            </span>
            <input
              type="text"
              placeholder="Search team member name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/80 bg-white/70 py-2.5 pl-9 pr-4 text-sm font-semibold text-slate-700 placeholder-slate-400 shadow-inner outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          {/* Quick Select Filter */}
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto no-scrollbar pr-1">
            {isLoading ? (
              <div className="py-6 text-center text-xs font-medium text-slate-400">
                ⏳ Synchronizing clinical team roster list...
              </div>
            ) : filteredNames.length > 0 ? (
              filteredNames.map((name) => {
                const initial = name.charAt(0).toUpperCase();
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onSelect(name)}
                    className="flex items-center justify-between rounded-2xl border border-slate-100/60 bg-white px-4 py-2.5 shadow-sm transition hover:border-indigo-100 hover:bg-indigo-50/50 hover:shadow-indigo-50 hover:scale-[1.01] active:scale-95 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 font-bold text-sm text-indigo-700 shadow-sm shadow-indigo-100">
                        {initial}
                      </div>
                      <span className="text-sm font-bold text-slate-700">{name}</span>
                    </div>
                    <span className="text-xs font-semibold text-indigo-500">Select →</span>
                  </button>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs font-medium text-slate-400">
                ⚠️ No team members match "{search}"
              </div>
            )}
          </div>
        </div>

        {/* Separator */}
        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-200/60"></div>
          <span className="flex-shrink mx-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            or alternative entry
          </span>
          <div className="flex-grow border-t border-slate-200/60"></div>
        </div>

        {/* Alternative Entries */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onSelect('')}
            className="w-full rounded-2xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200 hover:text-slate-700 active:scale-95 text-center shadow-inner"
          >
            👁️ Enter as Guest (Read-Only)
          </button>

          <button
            type="button"
            onClick={onAdminInit}
            className="w-full flex items-center justify-center gap-1.5 rounded-2xl border border-indigo-100 bg-indigo-50/30 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-50 active:scale-95"
          >
            🔒 Switch to Roster Maker (Admin)
          </button>
        </div>

        {/* Footer info */}
        <div className="text-center text-[10px] text-slate-400 font-medium leading-relaxed">
          Need roster assistance? Contact the Roster maker or Admin team.
        </div>
      </div>
    </div>
  );
}
