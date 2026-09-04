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
    'manage_payroll',
    'view_balance_sheet',
    'view_pl_account'
  ],
  accountant: [
    'manage_invoices',
    'manage_payroll',
    'manage_expenses',
    'view_vouchers',
    'create_vouchers',
    'edit_vouchers',
    'approve_vouchers',
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
    
    // Check user custom permissions (handle array, json string, or null)
    let userPerms = [];
    if (Array.isArray(req.user.permissions)) {
      userPerms = req.user.permissions;
    } else if (typeof req.user.permissions === 'string') {
      try {
        userPerms = JSON.parse(req.user.permissions);
      } catch (_) {
        userPerms = [];
      }
    }

    // Combine role base permissions with custom permissions
    const rolePerms = ROLE_PERMISSIONS[req.user.role] || [];
    const effectivePerms = new Set([...rolePerms, ...userPerms]);

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

module.exports = { authMiddleware, requireRole, requirePermission, ROLE_PERMISSIONS };
