import { useState, useMemo } from 'react';

export default function OnboardingOverlay({ names = [], onSelect, onAdminInit, isLoading }) {
  const [search, setSearch] = useState('');

  const filteredNames = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();
    if (!cleanSearch) return names.slice(0, 12); // show first 12 initially (3x4 grid)
    return names
      .filter((name) => name.toLowerCase().includes(cleanSearch))
      .slice(0, 12); // limit visible search results to fit 3x4 grid
  }, [names, search]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-tr from-slate-100 via-indigo-50/30 to-slate-200 p-4 backdrop-blur-xl animate-fadeIn">
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

      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/80 p-6 sm:p-8 shadow-2xl backdrop-blur-lg animate-slideUp flex flex-col gap-4 sm:gap-6 my-auto">
          
          {/* Brand Logo & Header */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-10 w-10 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white font-black text-base sm:text-2xl shadow-lg shadow-indigo-200 mb-2 sm:mb-4 animate-pulse">
              ED
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight">Welcome to ED Roster</h2>
            <p className="mt-1 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Medical Staff Roster Portal
            </p>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-xs hidden sm:block">
              Select your profile name below to personalize your shift duties, customized calendar views, and alert notifications.
            </p>
          </div>

          {/* Profile Selector & Search Box */}
          <div className="flex flex-col gap-2.5 sm:gap-3">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                🔎
              </span>
              <input
                type="text"
                placeholder="Search team member name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 py-2 sm:py-2.5 pl-9 pr-4 text-sm font-semibold text-slate-700 placeholder-slate-400 shadow-inner outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </div>

            {/* Quick Select Filter */}
            <div className="grid grid-cols-3 gap-2 max-h-48 sm:max-h-64 overflow-y-auto no-scrollbar pr-1 py-1">
              {isLoading ? (
                <>
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="animate-pulse h-8 bg-slate-200 rounded-full w-full" />
                  ))}
                </>
              ) : filteredNames.length > 0 ? (
                filteredNames.map((name) => {
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onSelect(name)}
                      title={name}
                      className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-200/80 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700 active:scale-95 cursor-pointer w-full min-w-0"
                    >
                      <span className="truncate">👤 {name}</span>
                    </button>
                  );
                })
              ) : (
                <div className="col-span-3 py-4 sm:py-6 text-center text-xs font-medium text-slate-400 w-full">
                  ⚠️ No team members match "{search}"
                </div>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="relative flex py-0.5 sm:py-1 items-center">
            <div className="flex-grow border-t border-slate-200/60"></div>
            <span className="flex-shrink mx-3 text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              or alternative entry
            </span>
            <div className="flex-grow border-t border-slate-200/60"></div>
          </div>

          {/* Alternative Entries */}
          <div className="flex flex-col gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => onSelect('Guest')}
              className="w-full rounded-2xl bg-slate-100 py-2 sm:py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200 hover:text-slate-700 active:scale-95 text-center shadow-inner"
            >
              👁️ Enter as Guest (Read-Only)
            </button>

            <button
              type="button"
              onClick={onAdminInit}
              className="w-full flex items-center justify-center gap-1.5 rounded-2xl border border-indigo-100 bg-indigo-50/30 py-1.5 sm:py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-50 active:scale-95"
            >
              🔒 Switch to Roster Maker (Admin)
            </button>
          </div>

          {/* Footer info */}
          <div className="text-center text-[10px] text-slate-400 font-medium leading-relaxed hidden sm:block">
            Need roster assistance? Contact the Roster maker or Admin team.
          </div>
        </div>
      </div>
    </div>
  );
}
