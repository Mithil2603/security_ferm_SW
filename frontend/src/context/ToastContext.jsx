import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, HelpCircle } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;
const toastListeners = new Set();
let confirmResolver = null;
const confirmListeners = new Set();

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

/**
 * Modern In-App Confirmation Dialog that returns a Promise<boolean>
 * Replaces ugly browser window.confirm()
 */
export const confirmDialog = (optionsOrMessage, title = 'Confirm Action') => {
  return new Promise((resolve) => {
    const config = typeof optionsOrMessage === 'string'
      ? { message: optionsOrMessage, title, confirmText: 'Confirm', cancelText: 'Cancel', variant: 'teal' }
      : {
          title: optionsOrMessage.title || title,
          message: optionsOrMessage.message || '',
          confirmText: optionsOrMessage.confirmText || 'Confirm',
          cancelText: optionsOrMessage.cancelText || 'Cancel',
          variant: optionsOrMessage.variant || 'teal'
        };

    confirmResolver = resolve;
    confirmListeners.forEach(listener => listener(config));
  });
};

// Global polyfills
if (typeof window !== 'undefined') {
  window.toast = toast;
  window.confirmDialog = confirmDialog;
  
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
  const [confirmConfig, setConfirmConfig] = useState(null);

  const addToast = useCallback((toastItem) => {
    setToasts(prev => [...prev, toastItem]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const openConfirm = useCallback((config) => {
    setConfirmConfig(config);
  }, []);

  const handleConfirmChoice = (confirmed) => {
    if (confirmResolver) {
      confirmResolver(confirmed);
      confirmResolver = null;
    }
    setConfirmConfig(null);
  };

  useEffect(() => {
    toastListeners.add(addToast);
    confirmListeners.add(openConfirm);
    return () => {
      toastListeners.delete(addToast);
      confirmListeners.delete(openConfirm);
    };
  }, [addToast, openConfirm]);

  return (
    <ToastContext.Provider value={{ toast, confirmDialog }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {confirmConfig && (
        <ConfirmModal
          config={confirmConfig}
          onConfirm={() => handleConfirmChoice(true)}
          onCancel={() => handleConfirmChoice(false)}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  return context?.toast || toast;
}

export function useConfirm() {
  return confirmDialog;
}

function ConfirmModal({ config, onConfirm, onCancel }) {
  const isDanger = config.variant === 'danger' || /delete|cancel|permanent|archive/i.test(config.title + ' ' + config.message);

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-slide-up p-6">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl shrink-0 ${
            isDanger ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-teal-50 text-teal-600 border border-teal-100'
          }`}>
            {isDanger ? <AlertTriangle className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900">{config.title || 'Confirm Action'}</h3>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-line">{config.message}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
          >
            {config.cancelText || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center gap-1.5 ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-900/20'
                : 'bg-teal-600 hover:bg-teal-700 shadow-teal-900/20'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{config.confirmText || 'Confirm'}</span>
          </button>
        </div>
      </div>
    </div>
  );
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
