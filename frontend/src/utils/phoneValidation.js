/**
 * Formats/sanitizes phone number input by restricting to numeric digits and capping at 10 digits maximum.
 * @param {string|number} val
 * @returns {string} 10-digit maximum numeric string
 */
export const sanitizePhone = (val) => {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '').slice(0, 10);
};

/**
 * Validates if the phone number has exactly 10 digits.
 * @param {string|number} val
 * @param {boolean} required Whether the phone field is mandatory
 * @returns {{ valid: boolean, error?: string }}
 */
export const validatePhone = (val, label = 'Phone number', required = false) => {
  if (!val || String(val).trim() === '') {
    if (required) {
      return { valid: false, error: `${label} is required (10 digits).` };
    }
    return { valid: true };
  }
  const digits = String(val).replace(/\D/g, '');
  if (digits.length < 10) {
    return {
      valid: false,
      error: `Please enter at least 10 digits for ${label.toLowerCase()} (currently ${digits.length} digits).`
    };
  }
  if (digits.length > 10) {
    return {
      valid: false,
      error: `${label} cannot exceed 10 digits.`
    };
  }
  return { valid: true };
};
