import { useState, useEffect } from 'react';
import api from '../../services/api';
import { format } from 'date-fns';
import {
  Database, HardDrive, FolderOpen, Download, Trash2,
  Play, Clock, CheckCircle2, AlertCircle, ShieldCheck,
  RefreshCw, FileArchive, Settings2, Save
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

import { getApiBaseUrl } from '../../utils/apiUrl';
import Toast from '../Toast';
import { toast, confirmDialog } from '../../context/ToastContext';

export default function DatabaseBackupTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [backups, setBackups] = useState([]);
  const [settings, setSettings] = useState({
    backup_destination_path: '',
    auto_backup_enabled: true,
    auto_backup_time: '02:00',
    auto_backup_frequency: 'daily',
    allowed_roles: ['admin']
  });

  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [toast, setToast] = useState({ show: false, message: '', type: 'error' });
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [browserData, setBrowserData] = useState({
    currentPath: '',
    parentPath: null,
    drives: [],
    subdirs: [],
    defaultPath: ''
  });
  const [browserLoading, setBrowserLoading] = useState(false);

  const showToast = (message, type = 'error') => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    fetchBackupData();
  }, []);

  const fetchBackupData = async () => {
    try {
      setLoading(true);
      setMessage({ type: '', text: '' });
      const res = await api.get('/backups');
      const backupList = res.data?.backups || res.backups || [];
      const backupSettings = res.data?.settings || res.settings || null;
      const activePath = res.data?.active_path || res.active_path || '';
      setBackups(backupList);
      if (backupSettings) {
        setSettings({
          ...backupSettings,
          backup_destination_path: backupSettings.backup_destination_path || activePath,
          auto_backup_time: backupSettings.auto_backup_time
            ? String(backupSettings.auto_backup_time).slice(0, 5)
            : '02:00'
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load backup data';
      setMessage({ type: 'error', text: msg });
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadBrowserDir = async (dirPath) => {
    try {
      setBrowserLoading(true);
      const res = await api.get(`/backups/browse-dirs?path=${encodeURIComponent(dirPath || '')}`);
      if (res.data || res.currentPath) {
        setBrowserData(res.data || res);
      }
    } catch (err) {
      console.error('Failed to browse directories:', err);
      showToast('Could not load directory listing', 'error');
    } finally {
      setBrowserLoading(false);
    }
  };

  const handleBrowseFolder = async () => {
    // 1. Electron Desktop Native Picker
    if (window.electronAPI && window.electronAPI.selectFolder) {
      try {
        const res = await window.electronAPI.selectFolder();
        if (!res.canceled && res.folderPath) {
          setSettings(prev => ({ ...prev, backup_destination_path: res.folderPath }));
          showToast('Folder selected: ' + res.folderPath, 'success');
          return;
        }
        if (res.canceled) return;
      } catch (_) {}
    }

    // 2. Web Browser: Launch Native Windows System Folder Dialog
    try {
      showToast('Opening Windows Folder Dialog...', 'info');
      const res = await api.post('/backups/system-folder-picker');
      if (res && !res.canceled && res.folderPath) {
        setSettings(prev => ({ ...prev, backup_destination_path: res.folderPath }));
        showToast('Selected: ' + res.folderPath, 'success');
        return;
      }
      if (res && res.canceled) {
        return;
      }
    } catch (err) {
      // Fallback to in-app directory picker if needed
      console.warn('System picker fallback:', err);
      await loadBrowserDir(settings.backup_destination_path || '');
      setFolderModalOpen(true);
    }
  };

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    try {
      setSavingSettings(true);
      setMessage({ type: '', text: '' });
      const payload = {
        ...settings,
        auto_backup_time: settings.auto_backup_time || '02:00'
      };
      await api.post('/backups/settings', payload);
      setMessage({ type: 'success', text: 'Backup configuration saved successfully!' });
      showToast('Backup configuration saved successfully!', 'success');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save backup configuration';
      setMessage({ type: 'error', text: msg });
      showToast(msg, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setCreatingBackup(true);
      setMessage({ type: '', text: '' });
      const res = await api.post('/backups/create');
      const filename = res.data?.filename || res.filename || 'manual_backup.zip';
      setMessage({
        type: 'success',
        text: `Manual backup "${filename}" created successfully!`
      });
      showToast(`Manual backup "${filename}" created successfully!`, 'success');
      await fetchBackupData();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to create database backup';
      setMessage({ type: 'error', text: msg });
      showToast(msg, 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDownloadBackup = (filename) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    window.open(`${getApiBaseUrl()}/backups/download/${filename}?token=${token}`, '_blank');
  };

  const handleDeleteBackup = async (filename) => {
    const confirmed = await confirmDialog({
      title: 'Delete Backup',
      message: `Are you sure you want to delete backup "${filename}"?`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/backups/${filename}`);
      toast.success(`Backup ${filename} deleted.`);
      setBackups(prev => prev.filter(b => b.filename !== filename));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete backup');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-teal-600 animate-spin" />
        <span className="ml-3 text-slate-600 font-medium">Loading database backup settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Feedback Banner */}
      {message.text && (
        <div className={`p-4 rounded-xl flex items-center gap-3 border ${
          message.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-rose-50 text-rose-800 border-rose-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Manual Backup Quick Action Header */}
      <div className="bg-gradient-to-r from-teal-700 to-teal-900 rounded-2xl p-6 text-white shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-6 h-6 text-teal-300" />
            <h2 className="text-xl font-bold">Database Backup & Storage</h2>
          </div>
          <p className="text-teal-100 text-sm max-w-xl">
            Safeguard your agency data. Configure automated daily backup schedules, set custom folder destinations, and create instant on-demand snapshots.
          </p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creatingBackup}
          className="flex items-center gap-2 px-5 py-3 bg-white text-teal-900 hover:bg-teal-50 font-bold rounded-xl shadow-md transition-all flex-shrink-0 disabled:opacity-50"
        >
          {creatingBackup ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin text-teal-600" />
              <span>Generating Backup...</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-teal-800 text-teal-800" />
              <span>Take Backup Now</span>
            </>
          )}
        </button>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Custom Destination Path */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="w-5 h-5 text-teal-600" />
              <h3 className="text-base font-bold text-slate-800">Backup Storage Location</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Select or type the destination folder path on this computer where all automatic and manual backups will be stored (e.g. <code>D:\AgencyBackups</code> or external disk).
            </p>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700">Destination Directory Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.backup_destination_path || ''}
                  onChange={(e) => setSettings({ ...settings, backup_destination_path: e.target.value })}
                  placeholder="e.g. D:\SecurityFirmBackups"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-slate-800 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs flex items-center gap-1.5 border border-slate-300 flex-shrink-0 transition-colors"
                >
                  <FolderOpen className="w-4 h-4 text-slate-600" />
                  <span>Browse</span>
                </button>
              </div>

              {/* Prominent Active Path Display */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-teal-600" />
                  <span>Current Active Storage Directory:</span>
                </div>
                <div className="font-mono text-xs text-teal-900 break-all select-all font-semibold bg-white p-2 rounded-lg border border-teal-200/60 shadow-xs">
                  {settings.backup_destination_path || 'Default local backups directory'}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings || !isAdmin}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Save Storage Path</span>
            </button>
          </div>
        </div>

        {/* Card 2: Auto Backup Schedule */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-800">Automated Backup Schedule</h3>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_backup_enabled}
                  onChange={(e) => setSettings({ ...settings, auto_backup_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
              </label>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Configure daily scheduled backups to automatically secure your database without any manual intervention.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Execution Time (Daily)</label>
                <div className="relative">
                  <input
                    type="time"
                    step="60"
                    value={settings.auto_backup_time ?? '02:00'}
                    onChange={(e) => setSettings({ ...settings, auto_backup_time: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:ring-2 focus:ring-teal-500 focus:outline-none cursor-pointer bg-white"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[11px] text-slate-400">Quick:</span>
                  {[
                    { label: '12:00 AM', val: '00:00' },
                    { label: '02:00 AM', val: '02:00' },
                    { label: '04:00 AM', val: '04:00' },
                    { label: '02:00 PM', val: '14:00' },
                    { label: '10:00 PM', val: '22:00' }
                  ].map(preset => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setSettings({ ...settings, auto_backup_time: preset.val })}
                      className={`px-2 py-0.5 text-[11px] rounded font-medium border transition-colors ${
                        (settings.auto_backup_time || '02:00').slice(0, 5) === preset.val
                          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Frequency</label>
                <select
                  value={settings.auto_backup_frequency || 'daily'}
                  onChange={(e) => setSettings({ ...settings, auto_backup_frequency: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                >
                  <option value="daily">Daily (Every Day)</option>
                  <option value="weekly">Weekly (Every Sunday)</option>
                </select>
                <span className="text-[11px] text-slate-400 mt-2 block">
                  Automatic backups run in the background at this time.
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings || !isAdmin}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Save Schedule</span>
            </button>
          </div>
        </div>
      </div>

      {/* Card 3: Permissions & Role-Based Access */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-teal-600" />
          <h3 className="text-base font-bold text-slate-800">Role-Based Backup Permissions</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          By default, only users with the <strong>Administrator (admin)</strong> role can configure, trigger, or download database backups.
        </p>

        <div className="flex flex-wrap gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
            <input type="checkbox" checked disabled className="rounded text-teal-600" />
            <span className="font-semibold">Administrator</span>
            <span className="text-xs text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded font-mono">Full Access (Always)</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.allowed_roles?.includes('manager') || false}
              onChange={(e) => {
                const currentRoles = settings.allowed_roles || ['admin'];
                const updated = e.target.checked
                  ? [...new Set([...currentRoles, 'manager'])]
                  : currentRoles.filter(r => r !== 'manager');
                setSettings({ ...settings, allowed_roles: updated });
              }}
              className="rounded text-teal-600 focus:ring-teal-500"
            />
            <span>Allow <strong>Manager</strong> Role</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.allowed_roles?.includes('accountant') || false}
              onChange={(e) => {
                const currentRoles = settings.allowed_roles || ['admin'];
                const updated = e.target.checked
                  ? [...new Set([...currentRoles, 'accountant'])]
                  : currentRoles.filter(r => r !== 'accountant');
                setSettings({ ...settings, allowed_roles: updated });
              }}
              className="rounded text-teal-600 focus:ring-teal-500"
            />
            <span>Allow <strong>Accountant</strong> Role</span>
          </label>
        </div>
      </div>

      {/* Card 4: Backup History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileArchive className="w-5 h-5 text-teal-600" />
            <h3 className="text-base font-bold text-slate-800">Available Backup Archives</h3>
          </div>
          <button
            onClick={fetchBackupData}
            className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh List</span>
          </button>
        </div>

        {backups.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-40 text-slate-400" />
            <p className="text-sm font-medium">No backup archives found yet.</p>
            <p className="text-xs text-slate-400 mt-1">Click "Take Backup Now" above to generate your first snapshot.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-3">Archive File Name</th>
                  <th className="px-6 py-3">Creation Date & Time</th>
                  <th className="px-6 py-3">Size</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-slate-800 font-medium flex items-center gap-2">
                      <FileArchive className="w-4 h-4 text-teal-600 flex-shrink-0" />
                      <span>{b.filename}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {b.createdAt ? format(new Date(b.createdAt), 'dd MMM yyyy, hh:mm:ss a') : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                      {formatFileSize(b.sizeBytes)}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleDownloadBackup(b.filename)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded-lg text-xs transition-colors"
                        title="Download ZIP"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteBackup(b.filename)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg text-xs transition-colors"
                          title="Delete Backup"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive Folder Browser Modal */}
      {folderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-800">Select Backup Destination Folder</h3>
              </div>
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                &times;
              </button>
            </div>

            {/* Quick Drive Presets & Defaults */}
            <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Quick Locations:</span>
              {browserData.drives?.map(drv => (
                <button
                  key={drv}
                  type="button"
                  onClick={() => loadBrowserDir(drv)}
                  className="px-2.5 py-1 bg-white hover:bg-teal-50 hover:text-teal-700 hover:border-teal-300 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors shadow-xs"
                >
                  {drv}
                </button>
              ))}
              {browserData.defaultPath && (
                <button
                  type="button"
                  onClick={() => loadBrowserDir(browserData.defaultPath)}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-bold transition-colors ml-auto shadow-xs"
                >
                  Default App Backups Folder
                </button>
              )}
            </div>

            {/* Current Path Bar & Up Navigation */}
            <div className="p-4 bg-white border-b border-slate-100 flex items-center gap-2">
              {browserData.parentPath && (
                <button
                  type="button"
                  onClick={() => loadBrowserDir(browserData.parentPath)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg flex items-center gap-1 shrink-0 transition-colors"
                  title="Go Up One Level"
                >
                  <span>⬆ Up</span>
                </button>
              )}
              <div className="flex-1 font-mono text-xs bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-slate-800 font-semibold break-all select-all whitespace-normal">
                {browserData.currentPath || 'Loading directory...'}
              </div>
            </div>

            {/* Subdirectories List */}
            <div className="p-4 overflow-y-auto flex-1 min-h-[220px] max-h-[350px] space-y-1">
              {browserLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-teal-600" />
                  <span className="text-sm font-medium">Scanning folders...</span>
                </div>
              ) : browserData.subdirs?.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs">
                  No subdirectories found in this folder. You can select this folder as the destination!
                </div>
              ) : (
                browserData.subdirs?.map(sub => (
                  <div
                    key={sub.path}
                    onClick={() => loadBrowserDir(sub.path)}
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <FolderOpen className="w-4 h-4 text-teal-600 shrink-0 group-hover:scale-110 transition-transform" />
                      <span className="text-xs font-semibold text-slate-700 truncate">{sub.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 group-hover:text-teal-600 font-medium shrink-0">Open →</span>
                  </div>
                ))
              )}
            </div>

            {/* Footer Action Buttons */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  if (browserData.currentPath) {
                    setSettings(prev => ({ ...prev, backup_destination_path: browserData.currentPath }));
                    showToast('Selected backup directory: ' + browserData.currentPath, 'success');
                    setFolderModalOpen(false);
                  }
                }}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Select This Folder</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ show: false, message: '', type: 'error' })}
        />
      )}
    </div>
  );
}
