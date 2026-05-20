import { useEffect } from 'react';

export default function ToastNotification({ toasts = [], onRemove }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full px-4 sm:px-0">
      {/* Inline styles for custom animations */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateY(1rem); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slideIn {
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {toasts.map((toast) => {
        const typeStyles = {
          success: 'bg-emerald-50/95 border-emerald-200/80 text-emerald-800 shadow-emerald-50/30',
          error: 'bg-rose-50/95 border-rose-200/80 text-rose-800 shadow-rose-50/30',
          info: 'bg-indigo-50/95 border-indigo-200/80 text-indigo-800 shadow-indigo-50/30',
          warning: 'bg-amber-50/95 border-amber-200/80 text-amber-800 shadow-amber-50/30',
        }[toast.type || 'info'];

        const typeIcon = {
          success: '✅',
          error: '❌',
          info: '🔄',
          warning: '⚠️',
        }[toast.type || 'info'];

        return (
          <ToastItem
            key={toast.id}
            toast={toast}
            styles={typeStyles}
            icon={typeIcon}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
}

function ToastItem({ toast, styles, icon, onRemove }) {
  useEffect(() => {
    if (toast.duration !== Infinity) {
      const timer = setTimeout(() => {
        onRemove(toast.id);
      }, toast.duration || 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, onRemove]);

  return (
    <div
      className={`flex items-center justify-between rounded-2xl border p-4 shadow-lg backdrop-blur-md transition-all duration-300 transform translate-y-0 scale-100 animate-slideIn ${styles}`}
      role="alert"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg shrink-0">{icon}</span>
        <span className="text-xs font-semibold leading-relaxed">{toast.message}</span>
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="ml-4 text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer active:scale-95 shrink-0"
        aria-label="Dismiss toast"
      >
        ✕
      </button>
    </div>
  );
}
