import { useState, useEffect } from 'react';
import { ShieldAlert, Key, Loader2, CheckCircle, AlertTriangle, Building2, Calendar, Users, Copy, Monitor } from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiUrl';

export default function LicenseActivation({ onActivated }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activated, setActivated] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [hardwareId, setHardwareId] = useState('Loading...');
  const [hwidCopied, setHwidCopied] = useState(false);

  useEffect(() => {
    const fetchHwid = async () => {
      if (window.electronAPI?.getHardwareId) {
        try {
          const hwid = await window.electronAPI.getHardwareId();
          if (hwid && hwid !== 'N/A') {
            setHardwareId(hwid);
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }
      try {
        const baseUrl = getApiBaseUrl();
        const res = await fetch(`${baseUrl}/license/hardware-id`);
        const data = await res.json();
        if (data.hardwareId) {
          setHardwareId(data.hardwareId);
          return;
        }
      } catch (e) {
        console.error(e);
      }
      setHardwareId('HWID-A1B2-C3D4');
    };

    fetchHwid();
  }, []);

  const copyHwid = () => {
    navigator.clipboard.writeText(hardwareId);
    setHwidCopied(true);
    setTimeout(() => setHwidCopied(false), 2000);
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setError('');

    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    setIsSubmitting(true);
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Invalid license key');
        return;
      }

      setLicenseInfo(data.license);
      setActivated(true);

      setTimeout(() => {
        if (onActivated) onActivated(data.license);
      }, 2500);

    } catch (err) {
      setError('Cannot connect to server. Please ensure the application is running correctly.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Success State ──
  if (activated && licenseInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="max-w-md w-full animate-slide-up">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30 mb-6">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">License Activated!</h2>
            <p className="text-emerald-400 mt-2">Your software is now ready to use</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl overflow-hidden p-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-3 text-slate-700">
                <Building2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Licensed To</p>
                  <p className="font-semibold">{licenseInfo.company}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 text-slate-700">
                <Users className="w-5 h-5 text-teal-600 flex-shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Max Users</p>
                  <p className="font-semibold">{licenseInfo.maxUsers}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 text-slate-700">
                <Calendar className="w-5 h-5 text-teal-600 flex-shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Valid Until</p>
                  <p className="font-semibold">
                    {licenseInfo.isPermanent ? '♾️ Permanent License' : licenseInfo.expiresAt}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 text-center">
              <p className="text-sm text-slate-400">Redirecting to login...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Activation Form ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">

        <div className="text-center mb-10 animate-slide-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30 mb-6">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">SecurManage</h2>
          <p className="text-slate-400 mt-2">Enterprise Security Agency Platform</p>
        </div>

        {/* Hardware ID Card */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Monitor className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Your Hardware ID</p>
                <p className="text-white font-mono font-bold text-sm mt-0.5">{hardwareId}</p>
              </div>
            </div>
            <button
              onClick={copyHwid}
              className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors text-slate-300 hover:text-white"
              title="Copy Hardware ID"
            >
              {hwidCopied ? (
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Share this ID with your administrator to receive your license key.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="p-8">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-amber-50 rounded-lg">
                <Key className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-800">License Activation</h3>
                <p className="text-sm text-slate-500">Enter your license key to continue</p>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start text-red-600 text-sm">
                <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleActivate} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">License Key</label>
                <textarea
                  required
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  rows={4}
                  className="block w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow bg-slate-50 focus:bg-white font-mono text-xs resize-none"
                  placeholder="Paste your license key here..."
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-colors disabled:opacity-70"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Key className="w-4 h-4 mr-2" />
                    Activate License
                  </>
                )}
              </button>
            </form>
          </div>
          <div className="px-8 py-4 bg-slate-50 border-t border-slate-100">
            <p className="text-xs text-slate-500 text-center">
              🔒 License keys are cryptographically signed and hardware-locked
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          © {new Date().getFullYear()} SecurManage — Enterprise Security Agency Platform
        </p>
      </div>
    </div>
  );
}
