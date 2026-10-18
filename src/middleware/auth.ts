import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fitbros_premium_secret_key_2026_xyz';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: String;
    email: String;
    role: 'CUSTOMER' | 'ADMIN';
    name: String;
  };
  sessionUsers?: Array<NonNullable<AuthenticatedRequest['user']>>;
}

export const authenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
};

export const authenticateAnyJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.admin_token || req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
};

export const authenticateSessions = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const tokens = [req.cookies?.admin_token, req.cookies?.token]
    .filter((token): token is string => Boolean(token));

  if (tokens.length === 0) {
    const headerToken = req.headers.authorization?.split(' ')[1];
    if (headerToken) tokens.push(headerToken);
  }

  req.sessionUsers = [];
  for (const token of tokens) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
      if (decoded && (decoded.role === 'ADMIN' || decoded.role === 'CUSTOMER')) {
        req.sessionUsers.push(decoded);
      }
    } catch {
      // An expired token for one role should not invalidate the other role's session.
    }
  }

  next();
};

export const authenticateAdminJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.admin_token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    if (decoded?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired admin authentication token.' });
  }
};

export const requireRole = (roles: ('CUSTOMER' | 'ADMIN')[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient privileges.' });
    }

    next();
  };
};
