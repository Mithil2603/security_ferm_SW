/**
 * Converts a number to standard Indian numbering words (Lakhs, Thousands, Rupees)
 * e.g. 76012 -> "Seventy Six Thousand Twelve Rupees Only"
 */
export function numberToIndianWords(num) {
  if (isNaN(num) || num === null || num === undefined) return '';
  const n = parseFloat(num);
  if (n === 0) return 'Zero Rupees Only';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(val) {
    if (val === 0) return '';
    if (val < 20) return a[val];
    if (val < 100) return b[Math.floor(val / 10)] + (val % 10 !== 0 ? ' ' + a[val % 10] : '');
    if (val < 1000) return a[Math.floor(val / 100)] + ' Hundred' + (val % 100 !== 0 ? ' ' + convert(val % 100) : '');
    if (val < 100000) return convert(Math.floor(val / 1000)) + ' Thousand' + (val % 1000 !== 0 ? ' ' + convert(val % 1000) : '');
    if (val < 10000000) return convert(Math.floor(val / 100000)) + ' Lakh' + (val % 100000 !== 0 ? ' ' + convert(val % 100000) : '');
    return convert(Math.floor(val / 10000000)) + ' Crore' + (val % 10000000 !== 0 ? ' ' + convert(val % 10000000) : '');
  }

  const intPart = Math.floor(Math.abs(n));
  const decPart = Math.round((Math.abs(n) - intPart) * 100);

  let words = convert(intPart).trim() + ' Rupees';
  if (decPart > 0) {
    words += ' and ' + convert(decPart).trim() + ' Paise';
  }
  return words + ' Only';
}
