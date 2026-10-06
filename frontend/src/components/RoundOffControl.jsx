// NOTE: the manual picker below is currently commented out (see the JSX) —
// only the automatic round off is shown. Kept for reference / re-enabling.
// Manual round-off for client bills: the user picks the final billed amount
// (e.g. 11,227 → 11,200) and the difference is booked as round off. Leaving it
// blank falls back to the automatic nearest-rupee round off (if enabled in settings).

const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Returns { finalAmount, roundOff, isCustom } for the live preview.
export function computeBilledTotal(total, autoRoundOffEnabled, customValue) {
  const raw = parseFloat((parseFloat(total) || 0).toFixed(2));
  const custom = parseFloat(customValue);
  if (customValue !== '' && customValue !== null && customValue !== undefined && Number.isFinite(custom) && custom >= 0) {
    const finalAmount = parseFloat(custom.toFixed(2));
    return { finalAmount, roundOff: parseFloat((finalAmount - raw).toFixed(2)), isCustom: true };
  }
  const finalAmount = autoRoundOffEnabled ? Math.round(raw) : raw;
  return { finalAmount, roundOff: parseFloat((finalAmount - raw).toFixed(2)), isCustom: false };
}

export default function RoundOffControl({ total, autoRoundOffEnabled, value, onChange }) {
  const raw = parseFloat((parseFloat(total) || 0).toFixed(2));
  const { finalAmount, roundOff, isCustom } = computeBilledTotal(raw, autoRoundOffEnabled, value);

  const suggestions = raw > 0
    ? [...new Set([
        Math.floor(raw / 100) * 100,
        Math.floor(raw / 10) * 10,
        Math.ceil(raw / 10) * 10,
        Math.ceil(raw / 100) * 100,
      ])].filter(v => v > 0 && v !== raw).sort((a, b) => a - b)
    : [];

  const largeAdjustment = isCustom && raw > 0 && Math.abs(roundOff) > raw * 0.01;

  return (
    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-700">Round Off Bill Amount</span>
        <span className="text-slate-500">Calculated total: <strong className="text-slate-800">₹{fmt(raw)}</strong></span>
      </div>

      {/* Manual round off (pick 11,200 for 11,227, or a custom amount) is hidden on
          invoices — manual rounding is done when recording the payment in
          Bank & Payments instead, so the issued invoice stays as billed. Only the
          automatic nearest-₹1 round off applies here.
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`px-2 py-1 rounded border font-semibold transition-colors cursor-pointer ${!isCustom ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
        >
          {autoRoundOffEnabled ? 'Auto (₹1)' : 'No Round Off'}
        </button>
        {suggestions.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(String(s))}
            className={`px-2 py-1 rounded border font-semibold transition-colors cursor-pointer ${isCustom && finalAmount === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            ₹{s.toLocaleString('en-IN')}
          </button>
        ))}
        <input
          type="number" min="0" step="0.01"
          placeholder="Custom amount"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-32 px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-teal-500 text-xs"
        />
      </div>
      */}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <span className="text-slate-600">
          Round Off: <strong className="text-slate-800">{roundOff > 0 ? `+₹${fmt(roundOff)}` : roundOff < 0 ? `-₹${fmt(Math.abs(roundOff))}` : '₹0.00'}</strong>
        </span>
        <span className="font-bold text-slate-800">
          Billed Total: <span className="text-teal-700 text-sm">₹{fmt(finalAmount)}</span>
        </span>
      </div>
      {largeAdjustment && (
        <p className="text-amber-700">Round off is more than 1% of the bill — double-check the amount.</p>
      )}
    </div>
  );
}
