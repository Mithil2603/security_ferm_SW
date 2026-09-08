const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    let token;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.query && (req.query.token || req.query.auth_token)) {
      token = req.query.token || req.query.auth_token;
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'No authentication token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired, please login again' });
    }
    return res.status(401).json({ success: false, message: 'Invalid authentication token' });
  }
};

const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'manage_employees',
    'manage_invoices',
    'manage_expenses',
    'view_reports',
    'view_vouchers',
    'create_vouchers',
    'edit_vouchers',
    'approve_vouchers',
    'manage_vouchers',
    'manage_payroll',
    'view_balance_sheet',
    'manage_bank_accounts',
    'manage_bank_reconciliation',
    'manage_budgets'
  ],
  accountant: [
    'manage_invoices',
    'manage_payroll',
    'manage_expenses',
    'view_vouchers',
    'create_vouchers',
    'edit_vouchers',
    'delete_vouchers',
    'approve_vouchers',
    'manage_vouchers',
    'view_reports',
    'view_pl_account',
    'view_balance_sheet',
    'manage_bank_accounts',
    'manage_bank_reconciliation',
    'manage_budgets'
  ],
  employee: [
    'view_reports'
  ]
};

const getEffectivePermissions = (role, permissions) => {
  if (role === 'admin') {
    return ['*'];
  }
  let parsed = null;
  if (Array.isArray(permissions)) {
    parsed = permissions;
  } else if (typeof permissions === 'string') {
    try {
      const json = JSON.parse(permissions);
      if (Array.isArray(json)) {
        parsed = json;
      }
    } catch (_) {
      parsed = null;
    }
  }

  // If user has explicitly defined custom permissions (even empty array), strictly use them!
  if (parsed !== null && Array.isArray(parsed)) {
    return parsed;
  }

  // Otherwise fall back to role default permissions
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`
      });
    }
    next();
  };
};

const requirePermission = (...perms) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Admins bypass all permission checks
    if (req.user.role === 'admin') {
      return next();
    }

    const effectivePermsList = getEffectivePermissions(req.user.role, req.user.permissions);
    const effectivePerms = new Set(effectivePermsList);

    const hasPerm = perms.some(p => effectivePerms.has(p) || effectivePerms.has('*'));
    
    if (!hasPerm) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of these permissions: ${perms.join(', ')}`
      });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole, requirePermission, ROLE_PERMISSIONS, getEffectivePermissions };
