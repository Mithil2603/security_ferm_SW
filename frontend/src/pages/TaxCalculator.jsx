import { useState, useEffect } from 'react';
import { Calculator, ArrowRightLeft, TrendingDown, IndianRupee, FileCheck, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api';

const SECTION_FIELDS = [
  { key: 'sec_80c_ppf', label: 'PPF', section: '80C' },
  { key: 'sec_80c_elss', label: 'ELSS Mutual Funds', section: '80C' },
  { key: 'sec_80c_lic', label: 'LIC Premium', section: '80C' },
  { key: 'sec_80c_nsc', label: 'NSC', section: '80C' },
  { key: 'sec_80c_tuition', label: 'Tuition Fees', section: '80C' },
  { key: 'sec_80c_home_loan_principal', label: 'Home Loan Principal', section: '80C' },
  { key: 'sec_80c_others', label: 'Others (FD, SCSS, etc.)', section: '80C' },
  { key: 'sec_80d_self', label: 'Self & Family Health Insurance', section: '80D' },
  { key: 'sec_80d_parents', label: 'Parents Health Insurance', section: '80D' },
  { key: 'sec_80d_senior_parents', label: 'Senior Citizen Parents', section: '80D' },
  { key: 'sec_80e_education_loan', label: 'Education Loan Interest', section: '80E' },
  { key: 'sec_80ccd_nps', label: 'NPS (Additional ₹50K)', section: '80CCD' },
  { key: 'sec_24b_home_loan_interest', label: 'Home Loan Interest', section: '24b' },
];

export default function TaxCalculatorPage() {
  const [mode, setMode] = useState('calculator'); // 'calculator' | 'comparison'
  const [form, setForm] = useState({
    grossAnnualIncome: '', regime: 'new', basicAnnual: '', hraAnnual: '', daAnnual: '',
    hra_rent_paid_annual: '0', hra_city_type: 'non_metro',
  });
  const [declarations, setDeclarations] = useState({});
  const [result, setResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDeductions, setShowDeductions] = useState(false);

  const handleInput = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleDeclInput = (e) => {
    const { name, value } = e.target;
    setDeclarations(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  const computeTax = async () => {
    setError('');
    const income = parseFloat(form.grossAnnualIncome) || 0;
    if (income < 0) {
      setError('Gross Annual Income must be a positive number.');
      return;
    }
    
    setLoading(true);
    try {
      const payload = {
        grossAnnualIncome: income,
        regime: form.regime,
        basicAnnual: parseFloat(form.basicAnnual) || 0,
        hraAnnual: parseFloat(form.hraAnnual) || 0,
        daAnnual: parseFloat(form.daAnnual) || 0,
        declarations: { ...declarations, hra_rent_paid_annual: parseFloat(form.hra_rent_paid_annual) || 0, hra_city_type: form.hra_city_type },
      };
      const res = await api.post('/tax/compute', payload);
      const data = res.data?.data || res.data;
      if (!data) throw new Error('Invalid response from server');
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Computation failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const compareRegimes = async () => {
    setError('');
    const income = parseFloat(form.grossAnnualIncome) || 0;
    if (income < 0) {
      setError('Gross Annual Income must be a positive number.');
      return;
    }
    
    setLoading(true);
    try {
      const payload = {
        grossAnnualIncome: income,
        basicAnnual: parseFloat(form.basicAnnual) || 0,
        hraAnnual: parseFloat(form.hraAnnual) || 0,
        daAnnual: parseFloat(form.daAnnual) || 0,
        declarations: { ...declarations, hra_rent_paid_annual: parseFloat(form.hra_rent_paid_annual) || 0, hra_city_type: form.hra_city_type },
      };
      const res = await api.post('/tax/compare-regimes', payload);
      const data = res.data?.data || res.data;
      if (!data) throw new Error('Invalid response from server');
      setComparison(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Comparison failed');
      setComparison(null);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v) => {
    const num = parseFloat(v);
    return isNaN(num) ? '₹0' : `₹${num.toLocaleString('en-IN')}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-teal-600" /> Tax Calculator
          </h1>
          <p className="text-slate-500 mt-1">Indian Income Tax — FY 2025-26 (New + Old Regime)</p>
        </div>
        <div className="flex bg-white rounded-lg p-1">
          <button onClick={() => setMode('calculator')} className={`px-4 py-2 rounded-lg text-sm transition-colors ${mode === 'calculator' ? 'bg-teal-600 text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}>
            <Calculator className="w-4 h-4 inline mr-1" /> Calculator
          </button>
          <button onClick={() => setMode('comparison')} className={`px-4 py-2 rounded-lg text-sm transition-colors ${mode === 'comparison' ? 'bg-teal-600 text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}>
            <ArrowRightLeft className="w-4 h-4 inline mr-1" /> Compare Regimes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Input Panel ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 border-b border-slate-200 pb-2">Income Details</h2>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Gross Annual Income (CTC) *</label>
              <input type="number" min="0" name="grossAnnualIncome" value={form.grossAnnualIncome} onChange={handleInput}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" placeholder="e.g. 600000" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Basic (Annual)</label>
                <input type="number" min="0" name="basicAnnual" value={form.basicAnnual} onChange={handleInput}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">HRA (Annual)</label>
                <input type="number" min="0" name="hraAnnual" value={form.hraAnnual} onChange={handleInput}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">DA (Annual)</label>
                <input type="number" min="0" name="daAnnual" value={form.daAnnual} onChange={handleInput}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
              </div>
            </div>

            {mode === 'calculator' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Tax Regime</label>
                <select name="regime" value={form.regime} onChange={handleInput}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                  <option value="new">New Regime (FY 2025-26)</option>
                  <option value="old">Old Regime</option>
                </select>
              </div>
            )}
          </div>

          {/* Deductions (collapsible, shown for old regime or compare) */}
          {(form.regime === 'old' || mode === 'comparison') && (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
              <button onClick={() => setShowDeductions(!showDeductions)} className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50">
                <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-green-400" /> Tax Saving Declarations (Old Regime)
                </span>
                {showDeductions ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {showDeductions && (
                <div className="p-4 pt-0 space-y-4 border-t border-slate-200">
                  {/* HRA */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Annual Rent Paid</label>
                      <input type="number" min="0" name="hra_rent_paid_annual" value={form.hra_rent_paid_annual} onChange={handleInput}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
                      {(form.hraAnnual > 0 && (!form.hra_rent_paid_annual || form.hra_rent_paid_annual <= 0)) && (
                        <p className="text-[10px] text-orange-500 mt-1">Requires rent paid to claim HRA exemption.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">City Type</label>
                      <select name="hra_city_type" value={form.hra_city_type} onChange={handleInput}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm">
                        <option value="metro">Metro (Delhi, Mumbai, etc.)</option>
                        <option value="non_metro">Non-Metro</option>
                      </select>
                    </div>
                  </div>

                  {/* Section-wise fields */}
                  {['80C', '80D', '80E', '80CCD', '24b'].map(section => {
                    const fields = SECTION_FIELDS.filter(f => f.section === section);
                    return (
                      <div key={section}>
                        <h4 className="text-xs text-slate-400 font-medium mb-2">Section {section}</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {fields.map(f => (
                            <div key={f.key}>
                              <label className="block text-[10px] text-gray-600 mb-0.5">{f.label}</label>
                              <input type="number" min="0" name={f.key} value={declarations[f.key] || ''} onChange={handleDeclInput}
                                className="w-full bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-900 text-xs" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button onClick={mode === 'calculator' ? computeTax : compareRegimes} disabled={loading || !form.grossAnnualIncome}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 text-slate-900 py-3 rounded-xl font-medium transition-colors">
            {loading ? 'Computing...' : mode === 'calculator' ? '🧮 Calculate Tax' : '⚖️ Compare Both Regimes'}
          </button>
        </div>

        {/* ─── Results Panel ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-500 text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Single Regime Result */}
          {mode === 'calculator' && result && (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-slate-700 border-b border-slate-200 pb-2">
                Tax Computation — {result.regime === 'new' ? 'New' : 'Old'} Regime
              </h2>

              <div className="space-y-2 text-sm">
                <Row label="Gross Annual Income" value={fmt(result.gross_annual_income)} />
                <Row label="Standard Deduction" value={`- ${fmt(result.standard_deduction)}`} color="text-green-400" />
                {result.hra_exemption > 0 && <Row label="HRA Exemption" value={`- ${fmt(result.hra_exemption)}`} color="text-green-400" />}
                {result.sec_80c_total > 0 && <Row label="Section 80C" value={`- ${fmt(result.sec_80c_total)}`} color="text-green-400" />}
                {result.sec_80d_total > 0 && <Row label="Section 80D" value={`- ${fmt(result.sec_80d_total)}`} color="text-green-400" />}
                {result.sec_80e_total > 0 && <Row label="Section 80E" value={`- ${fmt(result.sec_80e_total)}`} color="text-green-400" />}
                {result.sec_80ccd_nps > 0 && <Row label="Section 80CCD NPS" value={`- ${fmt(result.sec_80ccd_nps)}`} color="text-green-400" />}
                {result.sec_24b_home_loan > 0 && <Row label="Section 24b" value={`- ${fmt(result.sec_24b_home_loan)}`} color="text-green-400" />}
                <div className="border-t border-slate-200 pt-2">
                  <Row label="Taxable Income" value={fmt(result.taxable_income)} bold />
                </div>
                <Row label="Tax on Income" value={fmt(result.tax_on_income)} />
                {result.surcharge > 0 && <Row label="Surcharge" value={fmt(result.surcharge)} />}
                <Row label="Education Cess (4%)" value={fmt(result.education_cess)} />
              </div>

              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 text-center">
                <p className="text-orange-400 text-xs mb-1">Total Annual Tax</p>
                <p className="text-2xl font-bold text-orange-400">{fmt(result.total_annual_tax)}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/50 border border-slate-200 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Monthly TDS</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(result.monthly_tds)}</p>
                </div>
                <div className="bg-slate-900/50 border border-slate-200 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Effective Tax Rate</p>
                  <p className="text-lg font-bold text-slate-900">{result.effective_rate}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Regime Comparison */}
          {mode === 'comparison' && comparison && (
            <div className="space-y-4">
              {/* Recommendation Banner */}
              <div className={`rounded-xl p-4 border text-center ${
                comparison.recommended === 'new' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-purple-500/10 border-purple-500/30'
              }`}>
                <p className="text-xs text-slate-500 mb-1">Recommended Regime</p>
                <p className={`text-xl font-bold ${comparison.recommended === 'new' ? 'text-blue-600' : 'text-purple-400'}`}>
                  {comparison.recommended === 'new' ? '🆕 New Regime' : '📋 Old Regime'}
                </p>
                <p className="text-emerald-600 text-sm mt-1">
                  <TrendingDown className="w-4 h-4 inline" /> Save {fmt(comparison.annual_savings)}/year ({fmt(comparison.monthly_savings)}/month)
                </p>
              </div>

              {/* Side-by-side */}
              <div className="grid grid-cols-2 gap-4">
                {['new_regime', 'old_regime'].map(key => {
                  const r = comparison[key];
                  const isRecommended = (key === 'new_regime' && comparison.recommended === 'new') ||
                                        (key === 'old_regime' && comparison.recommended === 'old');
                  return (
                    <div key={key} className={`bg-white shadow-sm border rounded-xl p-4 ${
                      isRecommended ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-slate-200'
                    }`}>
                      <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-between">
                        {key === 'new_regime' ? 'New Regime' : 'Old Regime'}
                        {isRecommended && <span className="text-[10px] bg-emerald-500/20 text-emerald-600 px-2 py-0.5 rounded">BEST</span>}
                      </h3>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Taxable</span><span className="text-slate-900">{fmt(r.taxable_income)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Tax</span><span className="text-slate-900">{fmt(r.tax_on_income)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Cess</span><span className="text-slate-900">{fmt(r.education_cess)}</span></div>
                        <div className="border-t border-slate-200 pt-2 flex justify-between font-bold">
                          <span className="text-slate-500">Annual Tax</span>
                          <span className="text-orange-400">{fmt(r.total_annual_tax)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Monthly TDS</span>
                          <span className="text-slate-900">{fmt(r.monthly_tds)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!result && !comparison && (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-12 text-center text-slate-400">
              <Calculator className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Enter your income details and click compute to see tax breakdown.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color = 'text-slate-900', bold = false }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span className={color}>{value}</span>
    </div>
  );
}
