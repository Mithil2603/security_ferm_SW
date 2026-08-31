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
      setBackups(backupList);
      if (backupSettings) {
        setSettings(backupSettings);
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to load backup data'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseFolder = async () => {
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const res = await window.electronAPI.selectFolder();
      if (!res.canceled && res.folderPath) {
        setSettings(prev => ({ ...prev, backup_destination_path: res.folderPath }));
      }
    } else {
      alert('In desktop mode, this opens a Windows folder picker. You can also type or paste the exact folder path below.');
    }
  };

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    try {
      setSavingSettings(true);
      setMessage({ type: '', text: '' });
      await api.post('/backups/settings', settings);
      setMessage({ type: 'success', text: 'Backup configuration saved successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to save backup configuration'
      });
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
      await fetchBackupData();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to create database backup'
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDownloadBackup = (filename) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    window.open(`${getApiBaseUrl()}/backups/download/${filename}?token=${token}`, '_blank');
  };

  const handleDeleteBackup = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete backup "${filename}"?`)) return;
    try {
      await api.delete(`/backups/${filename}`);
      setMessage({ type: 'success', text: `Backup ${filename} deleted.` });
      setBackups(prev => prev.filter(b => b.filename !== filename));
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to delete backup'
      });
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Execution Time (Daily)</label>
                <input
                  type="time"
                  value={settings.auto_backup_time || '02:00'}
                  onChange={(e) => setSettings({ ...settings, auto_backup_time: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Default is 02:00 AM</span>
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
    </div>
  );
}
