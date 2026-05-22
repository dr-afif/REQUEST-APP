import { useState, useEffect } from 'react';

export default function PwaInstallBanner({ installPrompt, onDismiss }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (installPrompt) {
      // Small delay for clean entry animation after load
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [installPrompt]);

  if (!installPrompt || !isVisible) return null;

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    
    // Show native installation prompt
    installPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await installPrompt.userChoice;
    console.log(`PWA installation choice outcome: ${outcome}`);

    // Dismiss the banner
    setIsVisible(false);
    onDismiss();
  };

  const handleDismissClick = () => {
    setIsVisible(false);
    onDismiss();
  };

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 animate-slideUp">
      {/* Local keyframes for clean slide-up entrance */}
      <style>{`
        @keyframes pwaSlideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slideUp {
          animation: pwaSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-4">
        {/* Header Info */}
        <div className="flex gap-4 items-start">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white font-black text-lg shadow-lg shadow-indigo-100">
            ED
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight leading-none">
              Install ED Roster
            </h3>
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
              Web App Client
            </p>
            <p className="text-xs text-slate-500 leading-relaxed pr-2 mt-1">
              Add ED Roster to your home screen for quick offline access, a full-screen experience, and instant roster views.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleDismissClick}
            className="rounded-xl px-3 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition active:scale-[0.96] cursor-pointer"
          >
            Maybe Later
          </button>
          
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-200 hover:shadow-lg transition active:scale-[0.96] cursor-pointer"
          >
            📲 Install Now
          </button>
        </div>
      </div>
    </div>
  );
}
