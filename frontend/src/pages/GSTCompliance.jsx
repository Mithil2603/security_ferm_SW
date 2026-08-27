import { useState, useEffect } from 'react';
import { FileText, Settings, Layers, Download, Eye, X, Plus, Zap, ChevronRight } from 'lucide-react';
import api from '../services/api';
import TableSkeleton from '../components/TableSkeleton';

export default function GSTCompliance() {
  const [tab, setTab] = useState('returns'); // returns | hsn | config
  const [filings, setFilings] = useState([]);
  const [hsnCodes, setHsnCodes] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewFiling, setViewFiling] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [configError, setConfigError] = useState(null);

  // Config form
  const [configForm, setConfigForm] = useState({
    gstin: '', legal_name: '', trade_name: '', state_code: '', state_name: '',
    registration_type: '', default_tax_rate: '', financial_year: '',
  });

  const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);

  // Return Period Modal State
  const [returnModal, setReturnModal] = useState({ open: false, type: 'GSTR1', period: prevMonth });
  const [generatingReturn, setGeneratingReturn] = useState(false);

  // Add HSN Modal State
  const [isAddHSNOpen, setIsAddHSNOpen] = useState(false);
  const [hsnForm, setHsnForm] = useState({ code: '', type: 'HSN', description: '', gst_rate: 18, cgst_rate: 9, sgst_rate: 9, igst_rate: 18 });
  const [submittingHsn, setSubmittingHsn] = useState(false);

  const fetchFilings = async () => { try { setLoading(true); setErrorMsg(null); const r = await api.get('/gst/filings?limit=100'); setFilings(r.data.data || []); } catch { setErrorMsg('Failed to load filings'); setFilings([]); } finally { setLoading(false); } };
  const fetchHSN = async () => { try { setLoading(true); setErrorMsg(null); const r = await api.get('/gst/hsn-sac'); setHsnCodes(r.data.data || []); } catch { setErrorMsg('Failed to load HSN codes'); setHsnCodes([]); } finally { setLoading(false); } };
  const fetchConfig = async () => { 
    try { 
      setConfigError(null);
      const r = await api.get('/gst/config'); 
      setConfig(r.data.data); 
      if (r.data.data) {
        setConfigForm({
          gstin: r.data.data.gstin || '',
          legal_name: r.data.data.legal_name || '',
          trade_name: r.data.data.trade_name || '',
          state_code: r.data.data.state_code || '',
          state_name: r.data.data.state_name || '',
          registration_type: r.data.data.registration_type || 'regular',
          default_tax_rate: r.data.data.default_tax_rate || 18,
          financial_year: r.data.data.financial_year || ''
        });
      }

    } catch (err) {
      setConfigError(err.message || 'Failed to load GST config');
    } 
  };

  useEffect(() => {
    fetchConfig();
    if (tab === 'returns') fetchFilings();
    else if (tab === 'hsn') fetchHSN();
  }, [tab]);

  const fmt = (v) => { 
    const n = Number(v); 
    return isNaN(n) ? '₹0.00' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`; 
  };

  // ─── Generate Returns ──────────────────────────────────────────────────────
  const generateReturn = (type) => {
    setReturnModal({ open: true, type, period: prevMonth });
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    if (!returnModal.period) return;

    const exists = filings.some(f => f.return_type === returnModal.type && f.return_period === returnModal.period);
    if (exists && !window.confirm(`A ${returnModal.type} for ${returnModal.period} already exists. Regenerate?`)) {
      return;
    }

    setGeneratingReturn(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const endpoint = returnModal.type === 'GSTR1' ? '/gst/gstr1/generate' : '/gst/gstr3b/generate';
      const res = await api.post(endpoint, { return_period: returnModal.period });
      setSuccessMsg(`${returnModal.type} generated! ${res.data.data?.summary?.total_invoices || 0} invoices processed.`);
      setReturnModal({ open: false, type: 'GSTR1', period: prevMonth });
      try { await fetchFilings(); } catch (err) { setErrorMsg('Failed to refresh filings'); }
    } catch (err) {
      setErrorMsg(err.message || 'Generation failed');
    } finally {
      setGeneratingReturn(false);
    }
  };

  const handleAddHsn = async (e) => {
    e.preventDefault();
    setSubmittingHsn(true);
    try {
      await api.post('/gst/hsn-sac', hsnForm);
      setSuccessMsg('Code added successfully');
      setIsAddHSNOpen(false);
      setHsnForm({ code: '', type: 'HSN', description: '', gst_rate: 18, cgst_rate: 9, sgst_rate: 9, igst_rate: 18 });
      fetchHSN();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to add code');
    } finally {
      setSubmittingHsn(false);
    }
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await api.post('/gst/config', configForm);
      setSuccessMsg('GST configuration saved!');
      fetchConfig();
    } catch (err) { setErrorMsg(err.message || 'Failed to save configuration'); }
  };

  const openFiling = async (id) => {
    setErrorMsg(null);
    try {
      const r = await api.get(`/gst/filings/${id}`);
      setViewFiling(r.data.data || r.data);
    } catch { setErrorMsg('Failed to load filing'); }
  };

  const downloadFiling = async (id) => {
    try {
      const response = await api.get(`/gst/filings/${id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = response.headers['content-disposition'];
      let filename = `filing_${id}.json`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (err) {
      setErrorMsg('Failed to download filing');
    }
  };

  const markFiled = async (id) => {
    const arn = prompt("Enter ARN Number provided by GST Portal:");
    if (!arn) return;
    try {
      await api.post(`/gst/filings/${id}/mark-filed`, { arn_number: arn });
      setSuccessMsg('Filing marked as filed!');
      setViewFiling(null);
      fetchFilings();
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to mark as filed');
    }
  };

  const safeStringify = (jsonData) => {
    try {
      const obj = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return 'Invalid JSON Data';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {errorMsg && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex justify-between items-center">
          <p>{errorMsg}</p>
          <button onClick={() => setErrorMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 text-emerald-600 p-4 rounded-lg flex justify-between items-center">
          <p>{successMsg}</p>
          <button onClick={() => setSuccessMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-teal-600" /> GST Compliance
          </h1>
          <p className="text-slate-500 mt-1">GSTR-1, GSTR-3B Returns & HSN/SAC Codes</p>
        </div>
        {tab === 'returns' && config?.registration_type !== 'composition' && (
          <div className="flex gap-2">
            <button onClick={() => generateReturn('GSTR1')} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
              <Zap className="w-4 h-4" /> Generate GSTR-1
            </button>
            <button onClick={() => generateReturn('GSTR3B')} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
              <Zap className="w-4 h-4" /> Generate GSTR-3B
            </button>
          </div>
        )}
        {tab === 'returns' && config?.registration_type === 'composition' && (
          <div className="bg-amber-50 text-amber-600 px-4 py-2 rounded-lg text-sm border border-amber-200">
            Composition scheme returns (GSTR-4) not yet supported.
          </div>
        )}
        {tab === 'hsn' && (
          <button onClick={() => setIsAddHSNOpen(true)} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
            <Plus className="w-4 h-4" /> Add Code
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-white rounded-lg p-1 w-fit">
        {[
          { id: 'returns', label: 'GST Returns', icon: FileText },
          { id: 'hsn', label: 'HSN/SAC Codes', icon: Layers },
          { id: 'config', label: 'Configuration', icon: Settings },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === t.id ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Returns Tab ═══ */}
      {tab === 'returns' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left p-4 font-medium">Return</th>
                <th className="text-left p-4 font-medium">Period</th>
                <th className="text-right p-4 font-medium">Taxable Value</th>
                <th className="text-right p-4 font-medium">CGST</th>
                <th className="text-right p-4 font-medium">SGST</th>
                <th className="text-right p-4 font-medium">IGST</th>
                <th className="text-center p-4 font-medium">Invoices</th>
                <th className="text-center p-4 font-medium">Status</th>
                <th className="text-right p-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filings.length === 0 ? (
                <tr><td colSpan="9" className="p-8 text-center text-slate-400">No filings yet. Generate a GSTR-1 or GSTR-3B to get started.</td></tr>
              ) : filings.map(f => (
                <tr key={f.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                  <td className="p-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${f.return_type === 'GSTR1' ? 'bg-indigo-500/20 text-teal-600' : 'bg-purple-500/20 text-purple-400'}`}>
                      {f.return_type}
                    </span>
                  </td>
                  <td className="p-4 text-slate-900 font-medium">
                    {new Date(f.return_period + '-01').toLocaleDateString('en-US', {month: 'short', year: 'numeric'})}
                  </td>
                  <td className="p-4 text-right text-slate-900">{fmt(f.total_taxable_value)}</td>
                  <td className="p-4 text-right text-slate-700">{fmt(f.total_cgst)}</td>
                  <td className="p-4 text-right text-slate-700">{fmt(f.total_sgst)}</td>
                  <td className="p-4 text-right text-slate-700">{fmt(f.total_igst)}</td>
                  <td className="p-4 text-center text-slate-900">{f.total_invoices}</td>
                  <td className="p-4 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      f.status?.toLowerCase() === 'filed' ? 'bg-emerald-500/20 text-emerald-600' :
                      f.status?.toLowerCase() === 'generated' ? 'bg-amber-500/20 text-amber-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>{f.status}</span>
                  </td>
                  <td className="p-4 text-right flex gap-1 justify-end">
                    <button onClick={() => openFiling(f.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="View"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => downloadFiling(f.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Download JSON"><Download className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ HSN/SAC Tab ═══ */}
      {tab === 'hsn' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left p-4 font-medium">Code</th>
                <th className="text-left p-4 font-medium">Type</th>
                <th className="text-left p-4 font-medium">Description</th>
                <th className="text-right p-4 font-medium">GST Rate</th>
                <th className="text-right p-4 font-medium">CGST</th>
                <th className="text-right p-4 font-medium">SGST</th>
                <th className="text-right p-4 font-medium">IGST</th>
              </tr>
            </thead>
            <tbody>
              {hsnCodes.map(c => (
                <tr key={c.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="p-4 font-mono text-teal-600 font-bold">{c.code}</td>
                  <td className="p-4"><span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{c.type}</span></td>
                  <td className="p-4 text-slate-900">{c.description}</td>
                  <td className="p-4 text-right text-slate-900 font-medium">{c.gst_rate}%</td>
                  <td className="p-4 text-right text-slate-500">{c.cgst_rate}%</td>
                  <td className="p-4 text-right text-slate-500">{c.sgst_rate}%</td>
                  <td className="p-4 text-right text-slate-500">{c.igst_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ Config Tab ═══ */}
      {tab === 'config' && (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6 max-w-2xl">
          {configError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{configError}</div>
          )}
          <h2 className="text-sm font-bold text-slate-700 border-b border-slate-200 pb-2 mb-4">GST Registration Details</h2>
          <form onSubmit={saveConfig} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">GSTIN *</label>
                <input type="text" value={configForm.gstin} onChange={e => setConfigForm({...configForm, gstin: e.target.value})} maxLength={15} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 font-mono" placeholder="24AAAAA0000A1Z5" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Financial Year *</label>
                <input type="text" value={configForm.financial_year} onChange={e => setConfigForm({...configForm, financial_year: e.target.value})} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" placeholder="2025-26" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Legal Name *</label>
              <input type="text" value={configForm.legal_name} onChange={e => setConfigForm({...configForm, legal_name: e.target.value})} required
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Trade Name</label>
              <input type="text" value={configForm.trade_name || ''} onChange={e => setConfigForm({...configForm, trade_name: e.target.value})}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Registration Type *</label>
              <select value={configForm.registration_type} onChange={e => setConfigForm({...configForm, registration_type: e.target.value})} required
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                <option value="regular">Regular</option>
                <option value="composition">Composition</option>
                <option value="unregistered">Unregistered</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">State Code *</label>
                <input type="text" value={configForm.state_code} onChange={e => setConfigForm({...configForm, state_code: e.target.value})} maxLength={2} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">State Name *</label>
                <input type="text" value={configForm.state_name} onChange={e => setConfigForm({...configForm, state_name: e.target.value})} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Default GST Rate</label>
                <select value={configForm.default_tax_rate} onChange={e => setConfigForm({...configForm, default_tax_rate: parseFloat(e.target.value)})}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                  <option value={28}>28%</option>
                </select>
              </div>
            </div>
            <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Save Configuration</button>
          </form>
        </div>
      )}

      {/* ═══ Filing Detail Modal ═══ */}
      {viewFiling && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">
                {viewFiling.return_type} — {viewFiling.return_period}
              </h2>
              <button onClick={() => setViewFiling(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">Taxable Value</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(viewFiling.total_taxable_value)}</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">CGST</p>
                  <p className="text-lg font-bold text-blue-600">{fmt(viewFiling.total_cgst)}</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">SGST</p>
                  <p className="text-lg font-bold text-blue-600">{fmt(viewFiling.total_sgst)}</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">IGST</p>
                  <p className="text-lg font-bold text-orange-400">{fmt(viewFiling.total_igst)}</p>
                </div>
              </div>
              {viewFiling.json && (
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">JSON Data (Preview)</h3>
                  <pre className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-700 overflow-auto max-h-64 font-mono">
                    {safeStringify(viewFiling.json_data || viewFiling.json).replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                  </pre>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3">
              <button onClick={() => downloadFiling(viewFiling.id)} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                <Download className="w-4 h-4" /> Download JSON
              </button>
              {viewFiling.status?.toLowerCase() === 'generated' && (
                <button onClick={() => markFiled(viewFiling.id)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium">
                  Mark as Filed
                </button>
              )}
              <button onClick={() => setViewFiling(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Return Period Modal */}
      {returnModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-teal-50">
              <h3 className="text-lg font-bold text-teal-800">Generate {returnModal.type}</h3>
              <button type="button" onClick={() => setReturnModal({ open: false, type: 'GSTR1', period: new Date().toISOString().slice(0, 7) })} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleReturnSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Return Period (YYYY-MM)</label>
                <input
                  required
                  type="month"
                  value={returnModal.period}
                  onChange={e => setReturnModal({ ...returnModal, period: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-2">Ensure all invoices for this period are finalized before generating.</p>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setReturnModal({ open: false, type: 'GSTR1', period: prevMonth })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={generatingReturn} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {generatingReturn ? 'Generating...' : `Generate ${returnModal.type}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add HSN Modal */}
      {isAddHSNOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-teal-50">
              <h3 className="text-lg font-bold text-teal-800">Add HSN/SAC Code</h3>
              <button type="button" onClick={() => setIsAddHSNOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleAddHsn} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Code *</label>
                  <input required type="text" value={hsnForm.code} onChange={e => setHsnForm({...hsnForm, code: e.target.value})} maxLength={8}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type *</label>
                  <select required value={hsnForm.type} onChange={e => setHsnForm({...hsnForm, type: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500">
                    <option value="HSN">HSN (Goods)</option>
                    <option value="SAC">SAC (Services)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                <input required type="text" value={hsnForm.description} onChange={e => setHsnForm({...hsnForm, description: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">GST %</label>
                  <input required type="number" step="0.1" value={hsnForm.gst_rate} onChange={e => {
                    const r = parseFloat(e.target.value) || 0;
                    setHsnForm({...hsnForm, gst_rate: r, cgst_rate: r/2, sgst_rate: r/2, igst_rate: r});
                  }} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">CGST %</label>
                  <input disabled type="number" value={hsnForm.cgst_rate} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">SGST %</label>
                  <input disabled type="number" value={hsnForm.sgst_rate} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">IGST %</label>
                  <input disabled type="number" value={hsnForm.igst_rate} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsAddHSNOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submittingHsn} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {submittingHsn ? 'Saving...' : 'Save Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
