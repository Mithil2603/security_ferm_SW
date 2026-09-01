import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, CheckCircle, Loader2 } from 'lucide-react';
import { confirmDialog } from '../context/ToastContext';

export default function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Only works inside Electron
    if (!window.electronAPI?.onUpdateStatus) return;

    window.electronAPI.onUpdateStatus((data) => {
      setDismissed(false); // Show the bar again when status changes
      setUpdateInfo(data);
    });

    return () => {
      if (window.electronAPI?.removeUpdateListener) {
        window.electronAPI.removeUpdateListener();
      }
    };
  }, []);

  const handleInstall = async () => {
    const confirmed = await confirmDialog({
      title: 'Install Update & Restart',
      message: 'The app will restart to install the update.\n\nAny unsaved work will be lost. Continue?',
      confirmText: 'Restart & Install',
      variant: 'teal'
    });
    if (!confirmed) return;

    setInstalling(true);
    try {
      await window.electronAPI.installUpdate();
    } catch (err) {
      console.error('Failed to install update:', err);
      setInstalling(false);
    }
  };

  // Don't show anything if:
  // - Not in Electron
  // - No update info yet
  // - User dismissed the notification
  // - Update is not available (already on latest)
  if (!window.electronAPI?.isElectron) return null;
  if (!updateInfo) return null;
  if (dismissed) return null;
  if (updateInfo.status === 'not-available' || updateInfo.status === 'checking') return null;

  // Choose style based on status
  const isDownloaded = updateInfo.status === 'downloaded';
  const isDownloading = updateInfo.status === 'downloading' || updateInfo.status === 'available';

  return (
    <div className={`no-print flex items-center justify-between px-4 py-2 text-sm font-medium transition-all duration-300 ${
      isDownloaded 
        ? 'bg-emerald-500 text-white' 
        : 'bg-blue-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        {isDownloading && (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{updateInfo.message}</span>
            {updateInfo.percent !== undefined && (
              <div className="ml-2 w-32 bg-blue-300 rounded-full h-1.5">
                <div 
                  className="bg-white rounded-full h-1.5 transition-all duration-300" 
                  style={{ width: `${updateInfo.percent}%` }}
                />
              </div>
            )}
          </>
        )}
        {isDownloaded && (
          <>
            <CheckCircle className="h-4 w-4" />
            <span>{updateInfo.message}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isDownloaded && (
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1.5 px-3 py-1 bg-white text-emerald-600 rounded-md text-xs font-bold hover:bg-emerald-50 transition-colors disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {installing ? 'Installing...' : 'Restart & Update'}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-white/20 transition-colors"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
