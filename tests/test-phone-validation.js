const assert = require('assert');

const sanitizePhone = (val) => {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '').slice(0, 10);
};

const validatePhone = (val, label = 'Phone number', required = false) => {
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

console.log('Testing phone sanitization and validation...');

// 1. Sanitization tests
assert.strictEqual(sanitizePhone('9876543210123'), '9876543210', 'Should cap at 10 digits');
assert.strictEqual(sanitizePhone('+91 98765-43210'), '9198765432', 'Should strip non-digits and cap at 10 digits');
assert.strictEqual(sanitizePhone('abcd98765'), '98765', 'Should strip alphabets');

// 2. Validation tests
assert.strictEqual(validatePhone('9876543210', 'Phone', true).valid, true, 'Valid 10 digits should pass');
assert.strictEqual(validatePhone('', 'Phone', false).valid, true, 'Optional empty should pass');
assert.strictEqual(validatePhone('', 'Phone', true).valid, false, 'Required empty should fail');
assert.strictEqual(validatePhone('98765', 'Phone', true).valid, false, 'Less than 10 digits should fail');
assert.strictEqual(validatePhone('98765', 'Phone', false).valid, false, 'If typed and < 10 digits, should fail');

console.log('✅ ALL PHONE SANITIZATION & VALIDATION TESTS PASSED!');
