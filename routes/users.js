/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profile and management operations
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { CACHE_DURATIONS } from "../utils/constants.js";
import admin from 'firebase-admin'; // Add this import

const router = Router();
const firebaseService = new FirebaseService();
const db = admin.database(); // Add this line

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current user's profile
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Authentication required
 *   put:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile:
 *                 type: object
 *               personal:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Authentication required
 */

router.get("/profile", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const userData = req.userData;
    
    const sanitizedData = {
      ...userData,
      personal: {
        ...userData.personal,
        email: userData.personal?.email ? userData.personal.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : null
      }
    };
    
    res.json({
      success: true,
      data: sanitizedData,
      timestamp: new Date().toISOString()
    });
  })
);

router.put("/profile", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const updates = req.body;
    
    if (updates.permissions && req.userData?.permissions?.level < 8) {
      delete updates.permissions;
    }
    
    await firebaseService.updateUser(userId, updates);
    
    res.json({
      success: true,
      message: "Profile updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/users/permissions:
 *   get:
 *     summary: Get current user's permissions and department info
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User permissions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         level:
 *                           type: integer
 *                           description: User's permission level
 *                         roles:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: User's assigned roles
 *                         department:
 *                           type: string
 *                           description: User's department
 *                         permissions:
 *                           type: object
 *                           description: Detailed permission object
 *       401:
 *         description: Authentication required
 */

router.get("/permissions", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const userData = req.userData;
    
    // Handle both singular 'role' and plural 'roles' fields
    let roles = ['basic_access']; // default
    
    if (userData.permissions?.roles && Array.isArray(userData.permissions.roles)) {
      // If roles is already an array, use it
      roles = userData.permissions.roles;
    } else if (userData.permissions?.role) {
      // If role is a string, convert it to an array
      roles = [userData.permissions.role];
    }
    
    // Extract permission information
    const permissionData = {
      level: userData.permissions?.level || 1,
      roles: roles,
      department: userData.profile?.department || userData.permissions?.department || null,
      permissions: userData.permissions || {
        level: 1,
        roles: ['basic_access']
      }
    };
    
    res.json({
      success: true,
      data: permissionData,
      timestamp: new Date().toISOString()
    });
  })
);


/**
 * @swagger
 * /api/users/birthdays:
 *   get:
 *     summary: Get upcoming user birthdays
 *     description: Retrieve users with birthdays within the next 30 days, sorted by days until birthday
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days ahead to check for birthdays
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of birthdays to return
 *     responses:
 *       200:
 *         description: Birthdays retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           userUuid:
 *                             type: string
 *                             description: User's unique identifier
 *                           name:
 *                             type: string
 *                             description: User's display name
 *                           role:
 *                             type: string
 *                             description: User's role/position
 *                           avatar:
 *                             type: string
 *                             format: uri
 *                             description: User's avatar image URL
 *                           birthday:
 *                             type: string
 *                             description: Formatted birthday date (e.g., "Jan 15")
 *                           daysUntil:
 *                             type: integer
 *                             description: Number of days until birthday
 *                           age:
 *                             type: integer
 *                             description: Age the user will turn
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */

router.get("/birthdays", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { days = 30, limit = 50 } = req.query;
    const daysAhead = parseInt(days);
    const maxResults = parseInt(limit);
    
    const snapshot = await db.ref('users').once('value');
    
    const birthdays = [];
    const today = new Date();
    const currentYear = today.getFullYear();
    
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const userData = child.val();
        
        // Check if user has a dateOfBirth field
        if (userData.personal?.dateOfBirth) {
          try {
            const birthday = new Date(userData.personal.dateOfBirth);
            
            // Create birthday for this year
            const thisYearBirthday = new Date(currentYear, birthday.getMonth(), birthday.getDate());
            
            // If birthday already passed this year, check next year
            let nextBirthday = thisYearBirthday;
            if (thisYearBirthday < today) {
              nextBirthday = new Date(currentYear + 1, birthday.getMonth(), birthday.getDate());
            }
            
            // Calculate days until birthday
            const timeDiff = nextBirthday.getTime() - today.getTime();
            const daysUntil = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
            
            // Only include if within specified days
            if (daysUntil >= 0 && daysUntil <= daysAhead) {
              // Calculate age they will turn
              const ageThisYear = currentYear - birthday.getFullYear();
              const age = thisYearBirthday < today ? ageThisYear + 1 : ageThisYear;
              
              birthdays.push({
                userUuid: child.key,
                name: userData.profile?.username || userData.profile?.displayName || 'Unknown',
                role: userData.profile?.role || 'Unknown',
                avatar: userData.settings?.avatars?.first || 'https://cdn.discordapp.com/embed/avatars/0.png',
                birthday: nextBirthday.toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                }),
                daysUntil,
                age,
                originalBirthDate: userData.personal.dateOfBirth
              });
            }
          } catch (error) {
            console.error(`Error processing birthday for user ${child.key}:`, error);
          }
        }
      });
    }
    
    // Sort by days until birthday (closest first)
    birthdays.sort((a, b) => a.daysUntil - b.daysUntil);
    
    // Limit results
    const limitedBirthdays = birthdays.slice(0, maxResults);
    
    res.json({
      success: true,
      data: limitedBirthdays,
      meta: {
        total: birthdays.length,
        returned: limitedBirthdays.length,
        daysAhead,
        generatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Search users (requires level 3+ permission)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: Username to search for
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Department filter
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Role filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of results to skip
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *       403:
 *         description: Insufficient permissions
 */

router.get("/search", 
  authenticateFirebaseToken,
  requirePermission(3),
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { username, department, role, limit = 20, offset = 0 } = req.query;
    
    const filters = { username, department, role };
    const result = await firebaseService.searchUsers(filters, limit, offset);
    
    res.json({
      success: true,
      data: result.users,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get user by ID (requires level 3+ permission)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 */

router.get("/:userId", 
  authenticateFirebaseToken,
  requirePermission(3),
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const user = await firebaseService.getUser(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }
    
    res.json({
      success: true,
      data: user,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/users/{userId}/permissions:
 *   put:
 *     summary: Update user permissions (requires level 8+ permission)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *               level:
 *                 type: integer
 *               department:
 *                 type: string
 *     responses:
 *       200:
 *         description: Permissions updated successfully
 *       403:
 *         description: Insufficient permissions
 */

router.put("/:userId/permissions", 
  authenticateFirebaseToken,
  requirePermission(8),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { role, level, department } = req.body;
    
    const permissionUpdate = {
      "permissions/role": role,
      "permissions/level": level,
      "permissions/department": department
    };
    
    await firebaseService.updateUser(userId, permissionUpdate);
    
    res.json({
      success: true,
      message: "Permissions updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
