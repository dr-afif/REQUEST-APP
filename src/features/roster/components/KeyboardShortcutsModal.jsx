import React, { useEffect } from 'react';

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcutSections = [
    {
      title: 'Grid Navigation',
      items: [
        { keys: ['←', '→', '↑', '↓'], desc: 'Navigate between cells' },
        { keys: ['Home', 'End'], desc: 'Jump to first / last date in row' },
        { keys: ['Ctrl', 'Home'], desc: 'Jump to top-left of roster' },
        { keys: ['Ctrl', 'End'], desc: 'Jump to bottom-right of roster' }
      ]
    },
    {
      title: 'Draft Quick Entry',
      items: [
        { keys: ['Enter'], desc: 'Open shift palette / confirm selection' },
        { keys: ['A'], desc: 'Quick-pick AM shift' },
        { keys: ['P'], desc: 'Quick-pick PM shift' },
        { keys: ['O'], desc: 'Quick-pick OFF shift' },
        { keys: ['1', '2'], desc: 'Quick-pick ON1 / ON2 night shifts' },
        { keys: ['N'], desc: 'Quick-pick PN shift' },
        { keys: ['H'], desc: 'Quick-pick HKA holiday shift' },
        { keys: ['Del'], desc: 'Clear shift assignment' }
      ]
    },
    {
      title: 'Fast Workflow & Selection',
      items: [
        { keys: ['Ctrl', 'Enter'], desc: 'Repeat last assigned shift' },
        { keys: ['Shift', 'Arrows'], desc: 'Select rectangular range of cells' },
        { keys: ['Ctrl', 'C'], desc: 'Copy shift from cell' },
        { keys: ['Ctrl', 'V'], desc: 'Paste shift into cell(s)' },
        { keys: ['Ctrl', 'Z'], desc: 'Undo draft roster edit' },
        { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo draft roster edit' },
        { keys: ['Esc'], desc: 'Close palette / cancel range selection' }
      ]
    }
  ];

  return (
    <div
      id="keyboard-shortcuts-modal"
      data-testid="keyboard-shortcuts-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⌨️</span>
            <div>
              <h3 id="shortcuts-title" className="text-base font-bold text-slate-900">
                Keyboard Shortcuts
              </h3>
              <p className="text-xs text-slate-500">Fast roster-building navigation & quick entry</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-shortcuts-modal"
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
            aria-label="Close shortcuts"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {shortcutSections.map((sec) => (
            <div key={sec.title}>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {sec.title}
              </h4>
              <div className="space-y-1.5">
                {sec.items.map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-slate-50 text-xs"
                  >
                    <span className="text-slate-700 font-medium">{it.desc}</span>
                    <div className="flex items-center gap-1">
                      {it.keys.map((k, ki) => (
                        <kbd
                          key={ki}
                          className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-300 font-mono text-[11px] font-bold text-slate-800 shadow-2xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Shortcuts apply within roster workspace</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
