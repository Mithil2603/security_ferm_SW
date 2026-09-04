import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
export { useToast, toast, ToastProvider } from '../context/ToastContext';

export default function Toast({ message, type = 'error', onClose, duration = 3500 }) {
  const [visible, setVisible] = useState(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!message) return;
    setVisible(true);

    const dur = duration || 3500;
    const hideTimer = setTimeout(() => {
      setVisible(false);
      const closeTimer = setTimeout(() => {
        onCloseRef.current?.();
      }, 200);
      return () => clearTimeout(closeTimer);
    }, dur);

    return () => clearTimeout(hideTimer);
  }, [message, duration]);

  if (!message) return null;

  const isSuccess = type === 'success';
  const isError = type === 'error';
  const isWarning = type === 'warning';

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => {
      onCloseRef.current?.();
    }, 150);
  };

  return (
    <div 
      className={`fixed bottom-6 right-6 z-[99999] max-w-sm sm:max-w-md w-[calc(100%-3rem)] pointer-events-auto transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
      }`}
    >
      <div className={`p-4 rounded-2xl flex items-start gap-3 border shadow-2xl ${
        isSuccess
          ? 'bg-slate-900/95 text-emerald-300 border-emerald-500/50 shadow-emerald-950/40 backdrop-blur-md'
          : isError
          ? 'bg-slate-900/95 text-rose-300 border-rose-500/50 shadow-rose-950/40 backdrop-blur-md'
          : isWarning
          ? 'bg-slate-900/95 text-amber-300 border-amber-500/50 shadow-amber-950/40 backdrop-blur-md'
          : 'bg-slate-900/95 text-slate-100 border-slate-700 backdrop-blur-md'
      }`}>
        <div className="mt-0.5 shrink-0">
          {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-rose-400" />}
          {isWarning && <AlertTriangle className="w-5 h-5 text-amber-400" />}
          {!isSuccess && !isError && !isWarning && <Info className="w-5 h-5 text-teal-400" />}
        </div>
        <div className="flex-1 text-sm font-medium leading-relaxed pr-2 text-white break-words">
          {message}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
