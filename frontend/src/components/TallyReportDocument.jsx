// Shared "classic Tally printout" look, used on screen and for browser
// Print by Trial Balance, Bank Report and Cash Report alike: centered
// company letterhead, bold title + date subtitle, a single bordered table,
// bold group/total rows — matching the backend PDF export (tallyReportPdf.js)
// and docs/TrialBal.pdf.
const fmt = (n) => {
  const num = Number(n) || 0;
  if (num === 0) return '';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function TallyReportDocument({ companyName, companyAddress, companyEmail, title, subtitle, columns, rows, groupHeader }) {
  return (
    <div className="bg-white text-black w-full print:max-w-[740px] print:mx-auto">
      <div className="text-center mb-4 print:mb-3">
        <h1 className="text-2xl print:text-lg font-bold uppercase">{companyName || 'Company'}</h1>
        {companyAddress && <p className="text-sm print:text-xs">{companyAddress}</p>}
        {companyEmail && <p className="text-sm print:text-xs inline-block border-b border-black pb-0.5">E-Mail : {companyEmail}</p>}
        <h2 className="text-xl print:text-base font-bold mt-2">{title}</h2>
        {subtitle && <p className="text-sm print:text-xs mt-0.5">{subtitle}</p>}
      </div>

      <table className="w-full text-sm print:text-xs border-collapse">
        <thead>
          {groupHeader && (
            <tr className="border-t-2 border-black">
              <th></th>
              <th colSpan={columns.length - 1} className="py-2 print:py-1 text-center font-bold border-b border-black">{groupHeader}</th>
            </tr>
          )}
          <tr className={groupHeader ? 'border-b-2 border-black' : 'border-t-2 border-b-2 border-black'}>
            {columns.map((c, i) => (
              <th key={c.key} className={`py-2.5 print:py-1.5 px-2 print:px-1 font-bold ${i === 0 ? 'text-left' : 'text-right'}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="text-center py-8 text-slate-400">No data for this period.</td></tr>
          ) : rows.map((row, idx) => (
            <tr key={idx} className={row.type === 'total' ? 'border-t-2 border-black' : ''}>
              {columns.map((c, i) => {
                const val = row.values[c.key];
                const text = c.money ? fmt(val) : (val ?? '');
                const indent = i === 0 ? (row.indent || 0) * 20 : 0;
                return (
                  <td
                    key={c.key}
                    className={`py-1.5 print:py-1 px-2 print:px-1 ${i === 0 ? 'text-left' : 'text-right tabular-nums'} ${row.type !== 'detail' ? 'font-bold' : ''}`}
                    style={i === 0 ? { paddingLeft: 8 + indent } : undefined}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
