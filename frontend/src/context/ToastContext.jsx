import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;
// Global event bus for non-React callers
const toastListeners = new Set();

export const toast = {
  success: (message, duration = 4000) => {
    toastListeners.forEach(listener => listener({ id: ++toastId, message, type: 'success', duration }));
  },
  error: (message, duration = 5000) => {
    toastListeners.forEach(listener => listener({ id: ++toastId, message, type: 'error', duration }));
  },
  info: (message, duration = 4000) => {
    toastListeners.forEach(listener => listener({ id: ++toastId, message, type: 'info', duration }));
  },
  warning: (message, duration = 4500) => {
    toastListeners.forEach(listener => listener({ id: ++toastId, message, type: 'warning', duration }));
  }
};

// Also attach to window for any legacy or global utilities
if (typeof window !== 'undefined') {
  window.toast = toast;
  // Replace browser alert popup with toast notification
  window.alert = function (message) {
    if (!message) return;
    const msgStr = typeof message === 'object' ? JSON.stringify(message) : String(message);
    if (/fail|error|invalid|wrong|cannot|could not|not found|forbidden|unauthorized/i.test(msgStr)) {
      toast.error(msgStr);
    } else if (/success|done|saved|generated|created|updated|approved|uploaded/i.test(msgStr)) {
      toast.success(msgStr);
    } else {
      toast.info(msgStr);
    }
  };
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toastItem) => {
    setToasts(prev => [...prev, toastItem]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    toastListeners.add(addToast);
    return () => {
      toastListeners.delete(addToast);
    };
  }, [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  return context || toast;
}

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[99999] flex flex-col gap-2.5 max-w-sm sm:max-w-md w-[calc(100%-3rem)] pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} item={t} onDismiss={() => onRemove(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ item, onDismiss }) {
  useEffect(() => {
    if (!item.duration) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, onDismiss]);

  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isWarning = item.type === 'warning';

  return (
    <div className="pointer-events-auto transition-all animate-slide-up shadow-2xl rounded-2xl border overflow-hidden">
      <div className={`p-4 rounded-2xl flex items-start gap-3 border ${
        isSuccess
          ? 'bg-slate-900/95 text-emerald-300 border-emerald-500/40 shadow-emerald-950/40 backdrop-blur-md'
          : isError
          ? 'bg-slate-900/95 text-rose-300 border-rose-500/40 shadow-rose-950/40 backdrop-blur-md'
          : isWarning
          ? 'bg-slate-900/95 text-amber-300 border-amber-500/40 shadow-amber-950/40 backdrop-blur-md'
          : 'bg-slate-900/95 text-slate-100 border-slate-700 backdrop-blur-md'
      }`}>
        <div className="mt-0.5 shrink-0">
          {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-rose-400" />}
          {isWarning && <AlertTriangle className="w-5 h-5 text-amber-400" />}
          {!isSuccess && !isError && !isWarning && <Info className="w-5 h-5 text-teal-400" />}
        </div>
        <div className="flex-1 text-sm font-medium leading-relaxed pr-2 text-white break-words">
          {item.message}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default ToastProvider;
