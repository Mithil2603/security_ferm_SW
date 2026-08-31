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
    // Admins bypass all permission checks
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    
    // Check if the user has any of the requested permissions
    const userPerms = req.user?.permissions || [];
    const hasPerm = perms.some(p => userPerms.includes(p));
    
    if (!req.user || !hasPerm) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of these permissions: ${perms.join(', ')}`
      });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole, requirePermission };
