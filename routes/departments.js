/**
 * @swagger
 * tags:
 *   name: Departments
 *   description: Department management operations
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission, requireDepartment } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { CACHE_DURATIONS, DEPARTMENTS } from "../utils/constants.js";

const router = Router();
const firebaseService = new FirebaseService();

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Get all departments (requires level 1+ permission)
 *     tags: [Departments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Departments retrieved successfully
 *       403:
 *         description: Insufficient permissions
 *   post:
 *     summary: Create new department (requires level 8+ permission)
 *     tags: [Departments]
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
 *               - description
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               maxMembers:
 *                 type: integer
 *                 default: 50
 *               requiredLevel:
 *                 type: integer
 *                 default: 1
 *     responses:
 *       201:
 *         description: Department created successfully
 *       403:
 *         description: Insufficient permissions
 */

router.get("/", 
  authenticateFirebaseToken,
  requirePermission(1),
  cacheMiddleware(CACHE_DURATIONS.LONG),
  asyncHandler(async (req, res) => {
    const departments = await firebaseService.getDepartments();
    
    res.json({
      success: true,
      data: departments,
      count: Object.keys(departments).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/departments/{departmentId}:
 *   get:
 *     summary: Get specific department (requires level 1+ permission)
 *     tags: [Departments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: departmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Department ID
 *     responses:
 *       200:
 *         description: Department retrieved successfully
 *       404:
 *         description: Department not found
 */

router.get("/:departmentId", 
  authenticateFirebaseToken,
  requirePermission(1),
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    
    if (!Object.values(DEPARTMENTS).includes(departmentId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid department ID"
      });
    }
    
    const departments = await firebaseService.getDepartments();
    const department = departments[departmentId];
    
    if (!department) {
      return res.status(404).json({
        success: false,
        error: "Department not found"
      });
    }
    
    res.json({
      success: true,
      data: department,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/", 
  authenticateFirebaseToken,
  requirePermission(8),
  asyncHandler(async (req, res) => {
    const { name, description, maxMembers = 50, requiredLevel = 1 } = req.body;
    
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: "Name and description are required"
      });
    }
    
    const departmentId = name.toLowerCase().replace(/\s+/g, '_');
    const createdBy = req.authenticatedUser.uid;
    
    const departmentData = {
      name,
      description,
      isActive: true,
      members: [],
      settings: {
        maxMembers,
        autoApprove: false,
        requiredLevel
      },
      createdBy,
      createdAt: Date.now()
    };
    
    await firebaseService.db.ref(`/departments/${departmentId}`).set(departmentData);
    
    res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: { departmentId, ...departmentData },
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
