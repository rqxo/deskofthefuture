import admin from "../config/firebase.js";
import { AppError } from "./errorHandler.js";

// API Key configuration
const API_KEYS = {
  [process.env.INTERNAL_API_KEY]: {
    name: "Internal Service",
    permissions: { level: 10, department: "system", role: "system_admin" },
    uid: "system"
  },
  [process.env.PARTNER_API_KEY]: {
    name: "Partner Integration",
    permissions: { level: 3, department: "partner", role: "partner_api" },
    uid: "partner_api"
  }
};

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    const apiKey = req.headers['x-api-key'];

    if (!token && !apiKey) {
      throw new AppError("Authentication required - provide Bearer token or API key", 401);
    }

    // Handle API Key authentication
    if (apiKey && API_KEYS[apiKey]) {
      const keyData = API_KEYS[apiKey];
      req.authenticatedUser = { uid: keyData.uid, name: keyData.name };
      req.userData = {
        uid: keyData.uid,
        permissions: keyData.permissions,
        profile: { displayName: keyData.name },
        isApiKey: true
      };
      return next();
    }

    // Handle Firebase token authentication
    if (token) {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.authenticatedUser = decodedToken;
      
      const userSnapshot = await admin.database()
        .ref(`/users/${decodedToken.uid}`)
        .once('value');
      
      const userData = userSnapshot.val();
      
      if (!userData) {
        throw new AppError("User not found", 404);
      }
      
      // Ensure uid is included in userData
      req.userData = {
        uid: decodedToken.uid,
        ...userData,
        isApiKey: false
      };
      
      return next();
    }

    throw new AppError("Invalid authentication credentials", 401);

  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: "Firebase token expired"
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: "Invalid token format"
      });
    }
    
    return res.status(401).json({
      success: false,
      error: error.message || "Authentication failed"
    });
  }
};

export const requirePermission = (minLevel) => {
  return (req, res, next) => {
    const userLevel = req.userData?.permissions?.level || 0;
    const isApiKey = req.userData?.isApiKey || false;
    
    // API keys with system level bypass permission checks
    if (isApiKey && userLevel >= 10) {
      return next();
    }
    
    if (userLevel < minLevel) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required: ${minLevel}, Current: ${userLevel}`
      });
    }
    
    next();
  };
};

export const requireDepartment = (department) => {
  return (req, res, next) => {
    const userDepartment = req.userData?.permissions?.department;
    const userLevel = req.userData?.permissions?.level || 0;
    const isApiKey = req.userData?.isApiKey || false;
    
    // System API keys bypass department restrictions
    if (isApiKey && userLevel >= 10) {
      return next();
    }
    
    if (userLevel >= 8 || userDepartment === department) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      error: "Department access denied"
    });
  };
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    const userRole = req.userData?.permissions?.role;
    const userLevel = req.userData?.permissions?.level || 0;
    const isApiKey = req.userData?.isApiKey || false;
    
    // System API keys bypass role restrictions
    if (isApiKey && userLevel >= 10) {
      return next();
    }
    
    // Admin users (level 8+) bypass role restrictions
    if (userLevel >= 8) {
      return next();
    }
    
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Role access denied"
      });
    }
    
    next();
  };
};

export const requireDepartmentOrRole = (department, roles) => {
  return (req, res, next) => {
    const userDepartment = req.userData?.permissions?.department;
    const userRole = req.userData?.permissions?.role;
    const userLevel = req.userData?.permissions?.level || 0;
    const isApiKey = req.userData?.isApiKey || false;
    
    // System API keys bypass all restrictions
    if (isApiKey && userLevel >= 10) {
      return next();
    }
    
    // Admin users (level 8+) bypass restrictions
    if (userLevel >= 8) {
      return next();
    }
    
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (userDepartment === department || allowedRoles.includes(userRole)) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      error: "Department or role access denied"
    });
  };
};

// Add user validation middleware
export const validateUser = (req, res, next) => {
  if (!req.userData) {
    return res.status(401).json({
      success: false,
      error: "User authentication required"
    });
  }
  
  if (!req.userData.uid) {
    return res.status(401).json({
      success: false,
      error: "User ID not found"
    });
  }
  
  next();
};

// Alias for backward compatibility
export const authenticateFirebaseToken = authenticateToken;
