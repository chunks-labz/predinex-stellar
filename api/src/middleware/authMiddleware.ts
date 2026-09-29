/**
 * Authentication Middleware
 * 
 * Provides JWT token validation and user context attachment.
 * Issue #1294: Properly blocks unauthenticated requests when used with requireAuth
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface User {
  address: string;
  role: 'user' | 'compliance_officer' | 'admin';
  tier?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Auth middleware that attaches user context but doesn't block
 * Use requireAuth() to actually enforce authentication
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as User;
      req.user = decoded;
    } catch (error) {
      // Invalid token - continue without user context
      // Use requireAuth() if you want to block
    }
  }
  
  next();
};

/**
 * Require authentication - blocks if no valid token
 * Issue #1294: Use this for protected routes
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
  }
  next();
};

/**
 * Require specific role
 * Issue #1294: Use this to enforce compliance officer access
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
    }

    next();
  };
};

/**
 * Require compliance officer role
 * Issue #1294: Shorthand for compliance-protected endpoints
 */
export const requireComplianceOfficer = requireRole(['compliance_officer', 'admin']);
