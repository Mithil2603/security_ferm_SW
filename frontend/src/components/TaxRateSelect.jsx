// One dropdown that sets both the tax type and the GST % rate — the same
// option list as the Purchase Bill "% Rate" column, so every screen offers
// identical choices.

export const TAX_RATE_OPTIONS = [
  { label: 'Exempt (0%)', rate: 0, type: 'none' },
  { label: 'GST @ 0%', rate: 0, type: 'cgst_sgst' },
  { label: 'GST @ 5%', rate: 5, type: 'cgst_sgst' },
  { label: 'GST @ 12%', rate: 12, type: 'cgst_sgst' },
  { label: 'GST @ 18%', rate: 18, type: 'cgst_sgst' },
  { label: 'GST @ 28%', rate: 28, type: 'cgst_sgst' },
  { label: 'IGST @ 5%', rate: 5, type: 'igst' },
  { label: 'IGST @ 12%', rate: 12, type: 'igst' },
  { label: 'IGST @ 18%', rate: 18, type: 'igst' },
  { label: 'IGST @ 28%', rate: 28, type: 'igst' },
];

const keyOf = (type, rate) => (type === 'none' || !type ? 'none:0' : `${type}:${parseFloat(rate) || 0}`);

// onChange receives { tax_type, tax_rate } (tax_rate as a string, like the form fields).
export default function TaxRateSelect({ taxType, taxRate, onChange, className, disabled }) {
  const current = keyOf(taxType, taxRate);
  const options = [...TAX_RATE_OPTIONS];
  // Keep an existing non-standard rate (e.g. an older bill at 9%) selectable
  // instead of silently switching it to a different rate.
  if (!options.some(o => keyOf(o.type, o.rate) === current)) {
    const rate = parseFloat(taxRate) || 0;
    options.push({ label: `${taxType === 'igst' ? 'IGST' : 'GST'} @ ${rate}% (current)`, rate, type: taxType });
  }

  return (
    <select
      value={current}
      disabled={disabled}
      onChange={e => {
        const opt = options.find(o => keyOf(o.type, o.rate) === e.target.value);
        if (opt) onChange({ tax_type: opt.type, tax_rate: String(opt.rate) });
      }}
      className={className}
    >
      {options.map(o => (
        <option key={keyOf(o.type, o.rate)} value={keyOf(o.type, o.rate)}>{o.label}</option>
      ))}
    </select>
  );
}
