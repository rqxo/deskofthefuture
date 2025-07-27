/**
 * @swagger
 * tags:
 *   name: OAM
 *   description: One Account Manager - User management system
 */


import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();
const firebaseService = new FirebaseService();

/**
 * @swagger
 * /api/oam/users/{userId}/profile:
 *   get:
 *     summary: Get user profile (requires level 4+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]+$'
 *         description: Roblox user ID
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       404:
 *         description: User not found
 */

router.get("/users/:userId/profile", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    const profile = await firebaseService.getOAMUserProfile(userId);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "User profile not found"
      });
    }
    
    res.json({
      success: true,
      data: profile,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/oam/users/{userId}/game-data:
 *   put:
 *     summary: Update user's game data (requires level 4+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               workerPoints:
 *                 type: integer
 *               experience:
 *                 type: integer
 *               items:
 *                 type: array
 *                 items:
 *                   type: string
 *               currency:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Game data updated successfully
 */


router.put("/users/:userId/game-data", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { workerPoints, experience, items, currency } = req.body;
    const performedBy = req.authenticatedUser.uid;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    const updates = {};
    if (workerPoints !== undefined && Number.isInteger(workerPoints) && workerPoints >= 0) {
      updates.workerPoints = workerPoints;
    }
    if (experience !== undefined && Number.isInteger(experience) && experience >= 0) {
      updates.experience = experience;
    }
    if (items !== undefined && Array.isArray(items)) {
      updates.items = items;
    }
    if (currency !== undefined && Number.isInteger(currency) && currency >= 0) {
      updates.currency = currency;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid updates provided"
      });
    }
    
    await firebaseService.updateGameData(userId, updates, performedBy);
    
    res.json({
      success: true,
      message: "Game data updated successfully",
      data: { updated: Object.keys(updates) },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/oam/users/{userId}/moderation:
 *   post:
 *     summary: Create moderation action (requires level 4+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - reason
 *               - severity
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [warning, ban, permanent_ban, mute, kick]
 *               reason:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *               duration:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Moderation action created successfully
 */


router.post("/users/:userId/moderation", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { type, reason, severity, duration } = req.body;
    const performedBy = req.authenticatedUser.uid;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    const validTypes = ['warning', 'ban', 'permanent_ban', 'mute', 'kick'];
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid moderation type. Must be one of: ${validTypes.join(', ')}`
      });
    }
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: "Reason must be at least 10 characters long"
      });
    }
    
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({
        success: false,
        error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`
      });
    }
    
    if ((type === 'ban' || type === 'mute') && (!duration || duration <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Duration is required for temporary bans and mutes"
      });
    }
    
    const action = await firebaseService.createModerationAction(
      userId, 
      type, 
      reason.trim(), 
      severity, 
      duration, 
      performedBy
    );
    
    res.status(201).json({
      success: true,
      data: { actionId: action.id },
      message: "Moderation action created successfully",
      timestamp: new Date().toISOString()
    });
  })
);


/**
 * @swagger
 * /api/oam/users/{userId}/moderation-history:
 *   get:
 *     summary: Get user's moderation history (requires level 4+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Moderation history retrieved successfully
 */


router.get("/users/:userId/moderation-history", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    const snapshot = await firebaseService.db.ref('/oam/actions')
      .orderByChild('targetUser').equalTo(userId)
      .limitToLast(parseInt(limit))
      .once('value');
    
    const actions = snapshot.val() || {};
    const actionsList = Object.values(actions).sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({
      success: true,
      data: actionsList.slice(parseInt(offset)),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: actionsList.length
      },
      timestamp: new Date().toISOString()
    });
  })
);


/**
 * @swagger
 * /api/oam/users/{userId}/reset-password:
 *   post:
 *     summary: Reset user's password (requires level 5+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 */


router.post("/users/:userId/reset-password", 
  authenticateFirebaseToken,
  requirePermission(5),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const performedBy = req.authenticatedUser.uid;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    const newPassword = Math.random().toString(36).slice(-12);
    
    try {
      await admin.auth().updateUser(userId, {
        password: newPassword
      });
      
      await firebaseService.addLogEntry('oam_actions', {
        type: 'password_reset',
        targetUser: userId,
        performedBy: performedBy,
        timestamp: Date.now()
      });
      
      res.json({
        success: true,
        message: "Password reset successfully",
        data: { temporaryPassword: newPassword },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to reset password"
      });
    }
  })
);

/**
 * @swagger
 * /api/oam/users/{userId}/suspend:
 *   post:
 *     summary: Suspend user account (requires level 5+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *               - duration
 *             properties:
 *               reason:
 *                 type: string
 *               duration:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Account suspended successfully
 */

router.post("/users/:userId/suspend", 
  authenticateFirebaseToken,
  requirePermission(5),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { reason, duration } = req.body;
    const performedBy = req.authenticatedUser.uid;
    
    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user ID format"
      });
    }
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: "Suspension reason must be at least 10 characters long"
      });
    }
    
    if (!duration || duration <= 0) {
      return res.status(400).json({
        success: false,
        error: "Suspension duration must be greater than 0"
      });
    }
    
    const suspensionData = {
      isSuspended: true,
      suspensionReason: reason.trim(),
      suspensionExpires: Date.now() + (duration * 1000),
      suspendedBy: performedBy,
      suspendedAt: Date.now()
    };
    
    await firebaseService.updateUser(userId, { moderation: suspensionData });
    
    await firebaseService.addLogEntry('oam_actions', {
      type: 'account_suspended',
      targetUser: userId,
      performedBy: performedBy,
      details: { reason: reason.trim(), duration },
      timestamp: Date.now()
    });
    
    res.json({
      success: true,
      message: "Account suspended successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/oam/analytics/overview:
 *   get:
 *     summary: Get OAM analytics overview (requires level 6+ permission)
 *     tags: [OAM]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d]
 *           default: 30d
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
 */

router.get("/analytics/overview", 
  authenticateFirebaseToken,
  requirePermission(6),
  asyncHandler(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const now = Date.now();
    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    };
    
    const startTime = now - (periodMs[period] || periodMs['30d']);
    
    const [usersSnapshot, actionsSnapshot] = await Promise.all([
      firebaseService.db.ref('/users').once('value'),
      firebaseService.db.ref('/oam/actions').orderByChild('timestamp').startAt(startTime).once('value')
    ]);
    
    const users = usersSnapshot.val() || {};
    const actions = actionsSnapshot.val() || {};
    
    const analytics = {
      totalUsers: Object.keys(users).length,
      activeUsers: Object.values(users).filter(user => user.activity?.isActive).length,
      newUsers: Object.values(users).filter(user => user.activity?.createdAt >= startTime).length,
      totalActions: Object.keys(actions).length,
      actionsByType: {},
      usersByDepartment: {},
      usersByRole: {}
    };
    
    Object.values(actions).forEach(action => {
      analytics.actionsByType[action.type] = (analytics.actionsByType[action.type] || 0) + 1;
    });
    
    Object.values(users).forEach(user => {
      const dept = user.permissions?.department || 'unknown';
      const role = user.permissions?.role || 'unknown';
      
      analytics.usersByDepartment[dept] = (analytics.usersByDepartment[dept] || 0) + 1;
      analytics.usersByRole[role] = (analytics.usersByRole[role] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: analytics,
      period: period,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
