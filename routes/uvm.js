/**
 * @swagger
 * tags:
 *   name: UVM
 *   description: User Value Management system
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();
const firebaseService = new FirebaseService();

/**
 * @swagger
 * /api/uvm/users/{userId}/metrics:
 *   get:
 *     summary: Get user metrics (requires level 4+ permission)
 *     tags: [UVM]
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
 *         description: User metrics retrieved successfully
 *       404:
 *         description: User metrics not found
 *   put:
 *     summary: Update user metrics (requires level 4+ permission)
 *     tags: [UVM]
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
 *               - metrics
 *             properties:
 *               metrics:
 *                 type: object
 *     responses:
 *       200:
 *         description: User metrics updated successfully
 */

router.get("/users/:userId/metrics", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const metrics = await firebaseService.getUVMUserMetrics(userId);
    
    if (!metrics) {
      return res.status(404).json({
        success: false,
        error: "User metrics not found"
      });
    }
    
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  })
);

router.put("/users/:userId/metrics", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { metrics } = req.body;
    
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Metrics object is required"
      });
    }
    
    await firebaseService.updateUVMMetrics(userId, metrics);
    
    res.json({
      success: true,
      message: "User metrics updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/uvm/users/{userId}/segment:
 *   get:
 *     summary: Get user segment (requires level 4+ permission)
 *     tags: [UVM]
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
 *         description: User segment retrieved successfully
 */

router.get("/users/:userId/segment", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const segment = await firebaseService.getUserSegment(userId);
    
    res.json({
      success: true,
      data: { segment },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/uvm/segments:
 *   get:
 *     summary: Get all segments (requires level 5+ permission)
 *     tags: [UVM]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Segments retrieved successfully
 *   post:
 *     summary: Create new segment (requires level 7+ permission)
 *     tags: [UVM]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - criteria
 *             properties:
 *               name:
 *                 type: string
 *               criteria:
 *                 type: object
 *     responses:
 *       201:
 *         description: Segment created successfully
 */

router.get("/segments", 
  authenticateFirebaseToken,
  requirePermission(5),
  asyncHandler(async (req, res) => {
    const snapshot = await firebaseService.db.ref('/uvm/segments').once('value');
    const segments = snapshot.val() || {};
    
    res.json({
      success: true,
      data: segments,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/segments", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { name, criteria } = req.body;
    
    if (!name || !criteria || typeof criteria !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Name and criteria are required"
      });
    }
    
    const segmentData = {
      criteria,
      users: [],
      count: 0
    };
    
    await firebaseService.db.ref(`/uvm/segments/${name}`).set(segmentData);
    
    res.status(201).json({
      success: true,
      message: "Segment created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/uvm/analyze:
 *   post:
 *     summary: Analyze and update user segments (requires level 5+ permission)
 *     tags: [UVM]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User segments analyzed and updated
 */

router.post("/analyze", 
  authenticateFirebaseToken,
  requirePermission(5),
  asyncHandler(async (req, res) => {
    const usersSnapshot = await firebaseService.db.ref('/users').once('value');
    const users = usersSnapshot.val() || {};
    
    const segmentsSnapshot = await firebaseService.db.ref('/uvm/segments').once('value');
    const segments = segmentsSnapshot.val() || {};
    
    const segmentUpdates = {};
    
    for (const [segmentName, segment] of Object.entries(segments)) {
      const criteria = segment.criteria;
      const matchingUsers = [];
      
      for (const [userId, user] of Object.entries(users)) {
        const metrics = await firebaseService.getUVMUserMetrics(userId);
        
        if (!metrics) continue;
        
        let meetsAllCriteria = true;
        
        if (criteria.minEngagement && metrics.valueScore?.overall < criteria.minEngagement) {
          meetsAllCriteria = false;
        }
        
        if (criteria.minRetention && metrics.valueScore?.retention < criteria.minRetention) {
          meetsAllCriteria = false;
        }
        
        if (criteria.minActivity && metrics.engagementMetrics?.weeklyActivity < criteria.minActivity) {
          meetsAllCriteria = false;
        }
        
        if (meetsAllCriteria) {
          matchingUsers.push(userId);
        }
      }
      
      segmentUpdates[`/uvm/segments/${segmentName}/users`] = matchingUsers;
      segmentUpdates[`/uvm/segments/${segmentName}/count`] = matchingUsers.length;
    }
    
    await firebaseService.db.ref().update(segmentUpdates);
    
    res.json({
      success: true,
      message: "User segments analyzed and updated",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
