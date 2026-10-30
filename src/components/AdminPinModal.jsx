import { useState, useEffect } from 'react';
import { isDevMockActive, setDevMockActive } from '../features/roster/simplified/devMockApi.js';

export default function AdminPinModal({ isOpen, onClose, onSuccess, onVerifyPin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shake, setShake] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const CORRECT_PIN = import.meta?.env?.VITE_ADMIN_PIN || '1234';

  const triggerFailure = (msg = 'Incorrect Security PIN. Try again.') => {
    setError(true);
    setErrorMessage(msg);
    setShake(true);
    setPin('');
    setTimeout(() => setShake(false), 500);
  };

  const attemptUnlock = async (enteredPin) => {
    if (isVerifying || !enteredPin || enteredPin.length < 4) return;
    if (typeof onVerifyPin === 'function') {
      setIsVerifying(true);
      try {
        const res = await onVerifyPin(enteredPin);
        if (res === true || (res && typeof res === 'object' && res.ok !== false)) {
          onSuccess?.(enteredPin);
        } else {
          triggerFailure((res && res.message) || 'Incorrect Security PIN. Try again.');
        }
      } catch (err) {
        triggerFailure(err?.message || 'Incorrect Security PIN. Try again.');
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    if (enteredPin === CORRECT_PIN) {
      onSuccess?.(enteredPin);
    } else {
      triggerFailure('Incorrect Security PIN. Try again.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(false);
      setErrorMessage('');
      setShake(false);
      setIsVerifying(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (isVerifying) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length === 4) {
          attemptUnlock(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, pin, isVerifying, onSuccess, onClose, onVerifyPin]);

  if (!isOpen) return null;

  const handleKeyPress = (num) => {
    if (isVerifying) return;
    setError(false);
    setErrorMessage('');
    if (pin.length < 4) {
      setPin((prev) => prev + num);
    }
  };

  const handleBackspace = () => {
    if (isVerifying) return;
    setError(false);
    setErrorMessage('');
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isVerifying) return;
    setError(false);
    setErrorMessage('');
    setPin('');
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (pin.length === 4) {
      attemptUnlock(pin);
    }
  };

  return (
    <div data-testid="admin-pin-modal" className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm animate-fadeIn">
      {/* Scope Keyframe Animations */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scaleUp {
          animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div className="flex min-h-full items-center justify-center">
        <div 
          className={`w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-5 sm:p-6 shadow-2xl animate-scaleUp transition-all duration-300 my-auto ${
            shake ? 'animate-shake ring-2 ring-rose-500' : ''
          }`}
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-400 to-amber-600 text-white shadow-md shadow-amber-100 mb-2 sm:mb-3 text-lg sm:text-xl">
              🔒
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-800">Roster Administration</h3>
            <p className="mt-1 text-xs text-slate-500 px-2 leading-relaxed">
              Enter the 4-digit security PIN to unlock the administrative console.
            </p>
          </div>

          {/* Input PIN Preview */}
          <form onSubmit={handleSubmit} className="mt-4 sm:mt-5">
            <div className="relative flex items-center justify-center gap-3">
              {/* Visual Dot Indicators */}
              <div className="flex justify-center gap-4 py-1.5 sm:py-2">
                {[0, 1, 2, 3].map((index) => {
                  const hasChar = pin.length > index;
                  return (
                    <div
                      key={index}
                      className={`h-4 w-4 sm:h-4.5 sm:w-4.5 rounded-full border-2 transition-all duration-150 ${
                        error
                          ? 'border-rose-500 bg-rose-500'
                          : hasChar
                          ? 'border-indigo-600 bg-indigo-600 scale-110 shadow-sm shadow-indigo-100'
                          : 'border-slate-300 bg-transparent'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Secure / Show numerical preview */}
            {pin.length > 0 && (
              <div className="mt-1.5 text-center text-xs font-semibold text-slate-400">
                {showPin ? `Entered: ${pin}` : '••••'}
              </div>
            )}

            {error && (
              <div className="mt-2 sm:mt-3 text-center text-xs font-bold text-rose-500 animate-fadeIn">
                ❌ {errorMessage || 'Incorrect Security PIN. Try again.'}
              </div>
            )}

            {/* Visual Numpad */}
            <div className="mt-4 sm:mt-6 grid grid-cols-3 gap-2 px-2 sm:px-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeyPress(num.toString())}
                  className="flex h-10 sm:h-12 items-center justify-center rounded-xl bg-slate-50 text-base font-bold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-600 active:scale-95 shadow-sm border border-slate-100/60"
                >
                  {num}
                </button>
              ))}
              
              {/* Row 4 */}
              <button
                type="button"
                onClick={handleClear}
                className="flex h-10 sm:h-12 items-center justify-center rounded-xl bg-slate-50 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 active:scale-95 border border-slate-100/60"
                title="Clear"
              >
                Clear
              </button>
              
              <button
                type="button"
                onClick={() => handleKeyPress('0')}
                className="flex h-10 sm:h-12 items-center justify-center rounded-xl bg-slate-50 text-base font-bold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-600 active:scale-95 shadow-sm border border-slate-100/60"
              >
                0
              </button>
              
              <button
                type="button"
                onClick={handleBackspace}
                className="flex h-10 sm:h-12 items-center justify-center rounded-xl bg-slate-50 text-base font-bold text-slate-600 transition hover:bg-slate-100 active:scale-95 border border-slate-100/60"
                title="Backspace"
              >
                ⌫
              </button>
            </div>

            {/* Prompt Hint */}
            {CORRECT_PIN === '1234' && (
              <div className="mt-3 sm:mt-4 text-center text-[10px] font-medium text-slate-400">
                💡 Hint: Default admin PIN is <span className="font-bold text-slate-500">1234</span>
              </div>
            )}

            {!import.meta.env?.PROD && (
              <div className="mt-2 text-center text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const next = !isDevMockActive();
                    setDevMockActive(next);
                    window.location.reload();
                  }}
                  className="text-amber-600 hover:text-amber-700 underline font-medium cursor-pointer"
                >
                  {isDevMockActive() ? '🧪 Dev Mock Mode: Active (Click to Switch to Live)' : '🧪 Enable Safe Dev Mock Mode (Zero Live Mutations)'}
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-4 sm:mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-1.5 sm:py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 active:scale-95"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="admin-pin-unlock"
                disabled={pin.length < 4 || isVerifying}
                className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 py-1.5 sm:py-2 text-sm font-semibold text-white shadow-md shadow-indigo-100 transition hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50 disabled:shadow-none active:scale-95"
              >
                {isVerifying ? 'Verifying...' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
