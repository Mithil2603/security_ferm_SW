/**
 * Format Aadhaar card number as 1234-1234-1234
 * Supports unmasked digits, partially typed input, and masked numbers (e.g. XXXX-XXXX-1234).
 * @param {string|number} val
 * @returns {string}
 */
export const formatAadhar = (val) => {
  if (!val) return '';
  const str = String(val).trim();
  if (!str) return '';

  // If already masked or containing X/x
  if (str.includes('X') || str.includes('x')) {
    const clean = str.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < clean.length; i += 4) {
      parts.push(clean.substring(i, i + 4));
    }
    return parts.join('-');
  }

  // Strip non-digits and cap at 12 digits
  const digits = str.replace(/\D/g, '').slice(0, 12);
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.substring(i, i + 4));
  }
  return parts.join('-');
};

/**
 * Returns digits-only Aadhaar (e.g. 123412341234)
 * @param {string|number} val
 * @returns {string}
 */
export const cleanAadhar = (val) => {
  if (!val) return '';
  return String(val).replace(/\D/g, '').slice(0, 12);
};

/**
 * Masks Aadhaar number showing only the last 4 digits (e.g. XXXX-XXXX-1234)
 * @param {string|number} val
 * @returns {string}
 */
export const maskAadhar = (val) => {
  if (!val) return '—';
  const str = String(val).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `XXXX-XXXX-${digits.slice(-4)}`;
  }
  if (str.includes('X') || str.includes('x')) {
    const clean = str.replace(/[^0-9a-zA-Z]/g, '');
    if (clean.length >= 4) {
      return `XXXX-XXXX-${clean.slice(-4)}`;
    }
  }
  return 'XXXX-XXXX-XXXX';
};

/**
 * Masks PAN number showing only the last 4 characters (e.g. XXXXXX1234)
 * @param {string|number} val
 * @returns {string}
 */
export const maskPan = (val) => {
  if (!val) return '—';
  const str = String(val).trim().toUpperCase();
  if (str.length >= 4) {
    return 'XXXXXX' + str.slice(-4);
  }
  return 'XXXXXXXXXX';
};

/**
 * Masks bank account number showing only last 4 digits (e.g. ••••••••1234)
 * @param {string|number} val
 * @returns {string}
 */
export const maskBankAccount = (val) => {
  if (!val) return '—';
  const str = String(val).trim();
  if (str.length >= 4) {
    return '••••••••' + str.slice(-4);
  }
  return str;
};
