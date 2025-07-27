/**
 * @swagger
 * tags:
 *   name: Applications
 *   description: Application management with department/group support
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { CACHE_DURATIONS } from "../utils/constants.js";
import admin from 'firebase-admin';

const router = Router();
const db = admin.database();

// ==================== CONFIGURATION ====================

// Enhanced Permission Levels with Department/Group Support
const PERMISSION_LEVELS = {
  BASIC: 1,
  DEPARTMENT_ADMIN: 2,
  CORPORATE: 5,
  ADMIN: 8,
  DEVELOPER: 10
};

// Department/Group Definitions
const DEPARTMENTS = {
  // Groups (can access apps across departments)
  CORPORATE: 'corporate',
  HR: 'hr',
  MR: 'mr',
  LR: 'lr',
  // Departments (specific departmental apps)
  MODERATION: 'moderation',
  PUBLIC_RELATIONS: 'public-relations',
  TALENT_ACQUISITION: 'talent-acquisition'
};

// App Access Matrix based on your requirements
const APP_ACCESS_MATRIX = {
  // Universal apps - everyone has access
  universal: ['maia', 'forms', 'bake', 'dof', 'community', 'sessions'],
  
  // Corporate apps - only corporate group (can also access all other apps)
  corporate: ['oam-corporate', 'uvm-corporate', 'pvm-corporate', 'courses-corporate', 'forms-manager', 'assignments-manager'],
  
  // Department-specific apps
  moderation: ['oam-basic', 'uvm-basic', 'courses-moderation', 'bake-mod', 'assignments'],
  'public-relations': ['partners', 'pvm-basic', 'bake-partners', 'courses-pr', 'assignments'],
  'talent-acquisition': ['uvm-basic', 'myhr-manager', 'courses-ta', 'bake-hr', 'assignments'],
  
  // Group-specific apps
  hr: ['myhr-basic', 'performance', 'courses-hr', 'bake', 'sessions-manager', 'forms-manager', 'employee-directory', 'assignments-manager'],
  mr: ['myhr-basic', 'performance', 'courses-mr', 'bake', 'sessions-manager-basic', 'employee-directory', 'assignments'],
  lr: ['myhr-basic', 'performance', 'courses-mr', 'bake', 'sessions']
};

// Functional Categories
const FUNCTIONAL_CATEGORY_MAPPING = {
  productivity: ['forms', 'maia', 'workflow', 'automation', 'calendar', 'tasks', 'bake', 'assignments'],
  people: ['myhr', 'hr', 'payroll', 'recruitment', 'performance', 'employee-directory'],
  knowledge: ['courses', 'sessions', 'training', 'documentation', 'wiki'],
  operations: ['admin', 'settings', 'reports', 'analytics', 'monitoring', 'oam', 'uvm', 'partners', 'pvm']
};

const ALLOWED_IMAGE_DOMAINS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'imgur.com',
  'i.imgur.com',
  'github.com',
  'raw.githubusercontent.com'
];

// ==================== HELPER FUNCTIONS ====================

function validateUserId(userId) {
  return userId && typeof userId === 'string' && userId.trim() !== '';
}

function isValidImageUrl(url) {
  try {
    const urlObj = new URL(url);
    return ALLOWED_IMAGE_DOMAINS.some(domain => urlObj.hostname.includes(domain)) ||
           urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function getUserRoles(userData) {
  if (userData?.permissions?.roles && Array.isArray(userData.permissions.roles)) {
    return userData.permissions.roles;
  }
  if (userData?.permissions?.role) {
    return [userData.permissions.role];
  }
  return ['basic_access'];
}

function getUserDepartmentGroup(userData) {
  const primaryDepartment = userData?.onboarding?.primaryDepartment;
  const department = userData?.department || userData?.permissions?.department;
  
  return primaryDepartment || department || 'basic';
}

function getUserAccessibleApps(userData) {
  const userDepartment = getUserDepartmentGroup(userData);
  const userLevel = userData?.permissions?.level || PERMISSION_LEVELS.BASIC;
  
  console.log('Getting accessible apps for:', { userDepartment, userLevel });
  
  // Always start with universal apps
  let accessibleApps = [...APP_ACCESS_MATRIX.universal];
  
  // Developer access gets everything
  if (userLevel >= PERMISSION_LEVELS.DEVELOPER) {
    const allApps = Object.values(APP_ACCESS_MATRIX).flat();
    console.log('Developer access - returning all apps:', allApps.length);
    return [...new Set(allApps)];
  }
  
  // Corporate access gets all apps
  if (userDepartment === DEPARTMENTS.CORPORATE || userLevel >= PERMISSION_LEVELS.CORPORATE) {
    const allApps = Object.values(APP_ACCESS_MATRIX).flat();
    console.log('Corporate access - returning all apps:', allApps.length);
    return [...new Set(allApps)];
  }
  
  // Add department/group specific apps from APP_ACCESS_MATRIX
  if (APP_ACCESS_MATRIX[userDepartment]) {
    accessibleApps = [...accessibleApps, ...APP_ACCESS_MATRIX[userDepartment]];
  }
  
  const finalApps = [...new Set(accessibleApps)];
  console.log('Final accessible apps:', finalApps);
  return finalApps;
}

function hasAppAccess(userData, appId) {
  try {
    const accessibleApps = getUserAccessibleApps(userData);
    
    // Safety check to ensure we have an array
    if (!Array.isArray(accessibleApps)) {
      console.error('accessibleApps is not an array:', typeof accessibleApps, accessibleApps);
      return false;
    }
    
    return accessibleApps.includes(appId);
  } catch (error) {
    console.error('Error in hasAppAccess:', error);
    return false;
  }
}

function hasRequiredPermissions(userData, requiredPermissions) {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  
  const userLevel = userData?.permissions?.level || PERMISSION_LEVELS.BASIC;
  const userRoles = getUserRoles(userData);
  const userDepartment = getUserDepartmentGroup(userData);
  
  // Developer access
  if (userLevel >= PERMISSION_LEVELS.DEVELOPER) {
    return true;
  }
  
  // Corporate access
  if (userDepartment === DEPARTMENTS.CORPORATE || userLevel >= PERMISSION_LEVELS.CORPORATE) {
    return true;
  }
  
  // Check specific permissions
  return requiredPermissions.some(perm => {
    if (perm === 'basic_access') return userLevel >= PERMISSION_LEVELS.BASIC;
    if (perm === 'department_admin') return userLevel >= PERMISSION_LEVELS.DEPARTMENT_ADMIN;
    if (perm === 'corporate_access') return userDepartment === DEPARTMENTS.CORPORATE;
    if (perm === 'admin_access') return userLevel >= PERMISSION_LEVELS.ADMIN;
    if (perm === 'developer_access') return userLevel >= PERMISSION_LEVELS.DEVELOPER;
    if (perm === 'group_access') return userLevel >= PERMISSION_LEVELS.BASIC;
    if (perm === 'department_access') return userLevel >= PERMISSION_LEVELS.BASIC;
    
    return userRoles.includes(perm);
  });
}

function filterApplications(applications, userData, filters = {}) {
  const { department, category, enabled = true } = filters;
  const userDepartment = getUserDepartmentGroup(userData);
  const userLevel = userData?.permissions?.level || PERMISSION_LEVELS.BASIC;
  
  console.log('Filtering applications:', {
    totalApps: Object.keys(applications).length,
    userLevel,
    userDepartment,
    filters
  });

  const filteredApps = Object.entries(applications).filter(([appId, app]) => {
    try {
      // Check if app is enabled
      if (enabled && app.enabled === false) {
        return false;
      }

      // Smart filtering: Remove basic versions if user has corporate access
      if (userLevel >= PERMISSION_LEVELS.CORPORATE) {
        if (appId.includes('-basic') && applications[appId.replace('-basic', '-corporate')]) {
          return false;
        }
      }

      // Check app access based on department/group
      if (!hasAppAccess(userData, appId)) {
        return false;
      }

      // Check required permissions
      if (!hasRequiredPermissions(userData, app.requiredPermissions)) {
        return false;
      }

      // Apply filters
      if (department && app.department && app.department !== department) {
        return false;
      }

      if (category && app.category !== category) {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Error filtering app ${appId}:`, error);
      return false;
    }
  });

  console.log(`Filtered ${filteredApps.length} apps from ${Object.keys(applications).length} total`);
  return filteredApps;
}

function sortApplications(applications) {
  return applications.sort(([, a], [, b]) => {
    const orderA = a.order || 999;
    const orderB = b.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return (a.name || '').localeCompare(b.name || '');
  });
}

// ==================== DATABASE OPERATIONS ====================

async function getApplications() {
  try {
    console.log('=== APPLICATIONS DEBUG ===');
    console.log('Attempting to connect to applications in Realtime Database...');
    
    const ref = db.ref('applications');
    const snapshot = await ref.once('value');
    
    if (!snapshot.exists()) {
      console.log('No applications found in database');
      return {};
    }
    
    const applications = snapshot.val() || {};
    
    Object.keys(applications).forEach(key => {
      applications[key].id = key;
    });
    
    console.log('Total applications loaded:', Object.keys(applications).length);
    console.log('Application IDs:', Object.keys(applications));
    console.log('=== END APPLICATIONS DEBUG ===');
    
    return applications;
  } catch (error) {
    console.error('Error getting applications:', error);
    throw error;
  }
}

async function getUserFavorites(userId) {
  try {
    if (!validateUserId(userId)) {
      console.warn('Invalid userId provided to getUserFavorites:', userId);
      return [];
    }
    
    const ref = db.ref(`users/${userId}/settings/favorites`);
    const snapshot = await ref.once('value');
    
    if (!snapshot.exists()) {
      return [];
    }
    
    const favorites = snapshot.val();
    
    // Handle both array and object formats
    if (Array.isArray(favorites)) {
      return favorites;
    } else if (typeof favorites === 'object' && favorites !== null) {
      return Object.values(favorites);
    }
    
    return [];
  } catch (error) {
    console.error('Error getting user favorites:', error);
    return [];
  }
}

async function addToFavorites(userId, appId) {
  try {
    if (!validateUserId(userId) || !appId) {
      throw new Error('Invalid userId or appId provided');
    }
    
    const ref = db.ref(`users/${userId}/settings/favorites`);
    const snapshot = await ref.once('value');
    let currentFavorites = [];
    
    if (snapshot.exists()) {
      const favorites = snapshot.val();
      if (Array.isArray(favorites)) {
        currentFavorites = favorites;
      } else if (typeof favorites === 'object' && favorites !== null) {
        currentFavorites = Object.values(favorites);
      }
    }
    
    if (!currentFavorites.includes(appId)) {
      currentFavorites.push(appId);
      await ref.set(currentFavorites);
      await db.ref(`users/${userId}/settings/updatedAt`).set(Math.floor(Date.now() / 1000));
    }
    
    console.log(`Successfully managed favorites for user ${userId}`);
  } catch (error) {
    console.error('Error adding to favorites:', error);
    throw error;
  }
}

async function removeFromFavorites(userId, appId) {
  try {
    if (!validateUserId(userId) || !appId) {
      throw new Error('Invalid userId or appId provided');
    }
    
    const ref = db.ref(`users/${userId}/settings/favorites`);
    const snapshot = await ref.once('value');
    let currentFavorites = [];
    
    if (snapshot.exists()) {
      const favorites = snapshot.val();
      if (Array.isArray(favorites)) {
        currentFavorites = favorites;
      } else if (typeof favorites === 'object' && favorites !== null) {
        currentFavorites = Object.values(favorites);
      }
    }
    
    const updatedFavorites = currentFavorites.filter(id => id !== appId);
    await ref.set(updatedFavorites);
    await db.ref(`users/${userId}/settings/updatedAt`).set(Math.floor(Date.now() / 1000));
    
    console.log(`Successfully removed from favorites for user ${userId}`);
  } catch (error) {
    console.error('Error removing from favorites:', error);
    throw error;
  }
}

async function trackAppAccess(userId, appId) {
  try {
    if (!validateUserId(userId) || !appId) {
      throw new Error('Invalid userId or appId provided');
    }
    
    const analyticsRef = db.ref(`users/${userId}/settings/analytics`);
    const unixTimestamp = Math.floor(Date.now() / 1000);
    
    await analyticsRef.child('lastAccessed').set({
      appId: appId,
      timestamp: unixTimestamp
    });
    
    const usageRef = analyticsRef.child(`usageStats/${appId}`);
    await usageRef.transaction((currentCount) => {
      return (currentCount || 0) + 1;
    });
    
    const totalRef = analyticsRef.child('totalAccesses');
    await totalRef.transaction((currentTotal) => {
      return (currentTotal || 0) + 1;
    });
    
    await analyticsRef.child('updatedAt').set(unixTimestamp);
    
    console.log(`Tracked access to ${appId} for user ${userId}`);
  } catch (error) {
    console.error('Error tracking app access:', error);
  }
}

async function getUserAnalytics(userId) {
  try {
    if (!validateUserId(userId)) {
      return { mostUsed: [], lastAccessed: null, usageStats: {}, totalAccesses: 0 };
    }
    
    const ref = db.ref(`users/${userId}/settings/analytics`);
    const snapshot = await ref.once('value');
    
    if (!snapshot.exists()) {
      return { mostUsed: [], lastAccessed: null, usageStats: {}, totalAccesses: 0 };
    }
    
    const analyticsData = snapshot.val();
    const usageStats = analyticsData.usageStats || {};
    
    const mostUsed = Object.entries(usageStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([appId, count]) => ({ appId, count }));
    
    return {
      mostUsed,
      lastAccessed: analyticsData.lastAccessed || null,
      usageStats,
      totalAccesses: analyticsData.totalAccesses || 0
    };
  } catch (error) {
    console.error('Error getting user analytics:', error);
    return { mostUsed: [], lastAccessed: null, usageStats: {}, totalAccesses: 0 };
  }
}

async function createApplication(appId, applicationData) {
  try {
    const ref = db.ref(`applications/${appId}`);
    const unixTimestamp = Math.floor(Date.now() / 1000);
    
    await ref.set({
      ...applicationData,
      imageUrl: applicationData.imageUrl || null,
      createdAt: unixTimestamp,
      updatedAt: unixTimestamp
    });
    
    console.log(`Created application ${appId}`);
    return appId;
  } catch (error) {
    console.error('Error creating application:', error);
    throw error;
  }
}

async function updateApplication(appId, updateData) {
  try {
    const ref = db.ref(`applications/${appId}`);
    await ref.update({
      ...updateData,
      updatedAt: Math.floor(Date.now() / 1000)
    });
    
    console.log(`Updated application ${appId}`);
  } catch (error) {
    console.error('Error updating application:', error);
    throw error;
  }
}

// ==================== ROUTE HANDLERS ====================

router.get("/", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  cacheMiddleware(CACHE_DURATIONS.EXTENDED),
  asyncHandler(async (req, res) => {
    const { department, category, enabled = 'true' } = req.query;
    
    console.log('GET /applications request:', {
      department,
      category,
      enabled,
      user: req.userData?.uid,
      userDepartment: getUserDepartmentGroup(req.userData)
    });
    
    const applications = await getApplications();
    const filteredApps = filterApplications(applications, req.userData, {
      department,
      category,
      enabled: enabled === 'true'
    });
    
    const sortedApps = sortApplications(filteredApps);
    const result = Object.fromEntries(sortedApps);
    
    res.json({
      success: true,
      data: result,
      count: Object.keys(result).length,
      userDepartment: getUserDepartmentGroup(req.userData),
      userLevel: req.userData?.permissions?.level || PERMISSION_LEVELS.BASIC,
      accessibleApps: getUserAccessibleApps(req.userData),
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/categories", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  cacheMiddleware(CACHE_DURATIONS.LONG),
  asyncHandler(async (req, res) => {
    const { department } = req.query;
    
    const applications = await getApplications();
    const filteredApps = filterApplications(applications, req.userData, { department });
    
    const categorizedApps = {
      hr: {},
      department: {},
      admin: {},
      general: {},
      corporate: {}
    };
    
    filteredApps.forEach(([appId, app]) => {
      const category = app.category || 'general';
      if (categorizedApps[category]) {
        categorizedApps[category][appId] = app;
      }
    });
    
    Object.keys(categorizedApps).forEach(category => {
      const sortedEntries = Object.entries(categorizedApps[category])
        .sort(([, a], [, b]) => (a.order || 999) - (b.order || 999));
      categorizedApps[category] = Object.fromEntries(sortedEntries);
    });
    
    res.json({
      success: true,
      data: categorizedApps,
      userDepartment: getUserDepartmentGroup(req.userData),
      userLevel: req.userData?.permissions?.level || PERMISSION_LEVELS.BASIC,
      accessibleApps: getUserAccessibleApps(req.userData),
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/functional-categories", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  cacheMiddleware(CACHE_DURATIONS.LONG),
  asyncHandler(async (req, res) => {
    const applications = await getApplications();
    const filteredApps = filterApplications(applications, req.userData);
    
    const functionalCategories = {
      productivity: {},
      people: {},
      knowledge: {},
      operations: {}
    };
    
    filteredApps.forEach(([appId, app]) => {
      let functionalCategory = 'operations';
      
      for (const [category, keywords] of Object.entries(FUNCTIONAL_CATEGORY_MAPPING)) {
        if (keywords.some(keyword => 
          appId.toLowerCase().includes(keyword) || 
          (app.name && app.name.toLowerCase().includes(keyword)) ||
          (app.description && app.description.toLowerCase().includes(keyword))
        )) {
          functionalCategory = category;
          break;
        }
      }
      
      functionalCategories[functionalCategory][appId] = app;
    });
    
    Object.keys(functionalCategories).forEach(category => {
      const sortedEntries = Object.entries(functionalCategories[category])
        .sort(([, a], [, b]) => (a.order || 999) - (b.order || 999));
      functionalCategories[category] = Object.fromEntries(sortedEntries);
    });
    
    res.json({
      success: true,
      data: functionalCategories,
      userDepartment: getUserDepartmentGroup(req.userData),
      userLevel: req.userData?.permissions?.level || PERMISSION_LEVELS.BASIC,
      accessibleApps: getUserAccessibleApps(req.userData),
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/favorites", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const userId = req.userData?.uid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID not found in request"
      });
    }
    
    const userFavorites = await getUserFavorites(userId);
    const applications = await getApplications();
    
    const favoriteApps = {};
    userFavorites.forEach(appId => {
      if (applications[appId] && hasAppAccess(req.userData, appId)) {
        favoriteApps[appId] = applications[appId];
      }
    });
    
    res.json({
      success: true,
      data: favoriteApps,
      favoriteIds: userFavorites,
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.post("/favorites/:appId", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const userId = req.userData?.uid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID not found in request"
      });
    }
    
    if (!hasAppAccess(req.userData, appId)) {
      return res.status(403).json({
        success: false,
        error: "You don't have access to this application"
      });
    }
    
    await addToFavorites(userId, appId);
    
    res.json({
      success: true,
      message: "Application added to favorites",
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.delete("/favorites/:appId", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const userId = req.userData?.uid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID not found in request"
      });
    }
    
    await removeFromFavorites(userId, appId);
    
    res.json({
      success: true,
      message: "Application removed from favorites",
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/analytics", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const userId = req.userData?.uid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID not found in request"
      });
    }
    
    const analytics = await getUserAnalytics(userId);
    
    res.json({
      success: true,
      data: analytics,
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.post("/track/:appId", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const userId = req.userData?.uid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID not found in request"
      });
    }
    
    if (!hasAppAccess(req.userData, appId)) {
      return res.status(403).json({
        success: false,
        error: "You don't have access to this application"
      });
    }
    
    await trackAppAccess(userId, appId);
    
    res.json({
      success: true,
      message: "Access tracked",
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/department-info", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  asyncHandler(async (req, res) => {
    const userDepartment = getUserDepartmentGroup(req.userData);
    const accessibleApps = getUserAccessibleApps(req.userData);
    
    res.json({
      success: true,
      data: {
        userDepartment,
        accessibleApps,
        departmentList: Object.values(DEPARTMENTS),
        appMatrix: APP_ACCESS_MATRIX
      },
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.get("/:appId", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.BASIC),
  cacheMiddleware(CACHE_DURATIONS.LONG),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const applications = await getApplications();
    const application = applications[appId];
    
    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found"
      });
    }
    
    if (!hasAppAccess(req.userData, appId)) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to access this application"
      });
    }
    
    res.json({
      success: true,
      data: application,
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.post("/", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.ADMIN),
  asyncHandler(async (req, res) => {
    const applicationData = req.body;
    
    const requiredFields = ['id', 'name', 'description', 'category', 'icon', 'href'];
    for (const field of requiredFields) {
      if (!applicationData[field]) {
        return res.status(400).json({
          success: false,
          error: `Missing required field: ${field}`
        });
      }
    }
    
    if (applicationData.imageUrl && !isValidImageUrl(applicationData.imageUrl)) {
      return res.status(400).json({
        success: false,
        error: "Invalid image URL format"
      });
    }
    
    const appData = {
      ...applicationData,
      enabled: applicationData.enabled !== false,
      order: applicationData.order || 999,
      requiredPermissions: applicationData.requiredPermissions || ['basic_access']
    };
    
    await createApplication(applicationData.id, appData);
    
    res.status(201).json({
      success: true,
      message: "Application created successfully",
      data: { id: applicationData.id },
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);

router.put("/:appId", 
  authenticateFirebaseToken,
  requirePermission(PERMISSION_LEVELS.ADMIN),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const updateData = req.body;
    
    if (updateData.imageUrl && !isValidImageUrl(updateData.imageUrl)) {
      return res.status(400).json({
        success: false,
        error: "Invalid image URL format"
      });
    }
    
    await updateApplication(appId, updateData);
    
    res.json({
      success: true,
      message: "Application updated successfully",
      timestamp: Math.floor(Date.now() / 1000)
    });
  })
);



export default router;
