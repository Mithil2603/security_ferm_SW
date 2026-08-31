import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ message, type = 'error', onClose, duration = 4000 }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const isSuccess = type === 'success';
  const isError = type === 'error';

  return (
    <div className="fixed bottom-6 right-6 z-[100] max-w-sm sm:max-w-md w-[calc(100%-3rem)] animate-slide-up shadow-2xl rounded-2xl border pointer-events-auto transition-all">
      <div className={`p-4 rounded-2xl flex items-start gap-3 border ${
        isSuccess
          ? 'bg-slate-900 text-emerald-300 border-emerald-500/50 shadow-emerald-950/40 backdrop-blur-md'
          : isError
          ? 'bg-slate-900 text-rose-300 border-rose-500/50 shadow-rose-950/40 backdrop-blur-md'
          : 'bg-slate-900 text-slate-100 border-slate-700 backdrop-blur-md'
      }`}>
        <div className="mt-0.5 shrink-0">
          {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-rose-400" />}
          {!isSuccess && !isError && <Info className="w-5 h-5 text-teal-400" />}
        </div>
        <div className="flex-1 text-sm font-medium leading-relaxed pr-2 text-white">
          {message}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
