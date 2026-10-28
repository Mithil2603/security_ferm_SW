import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, Building2, Loader2, ChevronRight, AlertCircle } from 'lucide-react';

export default function SelectCompany() {
  const { switchCompany } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const companies = location.state?.companies || [];
  const [switchingId, setSwitchingId] = useState(null);
  const [error, setError] = useState(null);

  const handleSelect = async (companyId) => {
    setError(null);
    setSwitchingId(companyId);
    try {
      await switchCompany(companyId);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to select company');
      setSwitchingId(null);
    }
  };

  if (companies.length === 0) {
    // Nothing to pick from (e.g. a direct page refresh lost the state) —
    // send them back to log in again.
    navigate('/login', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-10 animate-slide-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30 mb-6">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Select a company</h2>
          <p className="text-slate-400 mt-2">Choose which company you'd like to work in</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up" style={{ animationDelay: '0.1s' }}>
          {error && (
            <div className="m-6 mb-0 bg-red-50 border border-red-100 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c.id)}
                disabled={switchingId !== null}
                className="w-full flex items-center gap-4 px-6 py-5 text-left hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                  {c.legal_name && <p className="text-xs text-slate-400 truncate">{c.legal_name}</p>}
                </div>
                {switchingId === c.id ? (
                  <Loader2 className="w-5 h-5 animate-spin text-teal-500 shrink-0" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
