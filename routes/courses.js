/**
 * @swagger
 * tags:
 *   name: Courses
 *   description: Training course management
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();
const firebaseService = new FirebaseService();

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: Get available courses
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [beginner, intermediate, advanced]
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Courses retrieved successfully
 */


router.get("/", 
  authenticateFirebaseToken,
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { difficulty, department } = req.query;
    const userRole = req.userData.permissions.role;
    
    const courses = await firebaseService.getCourses([userRole], difficulty);
    
    res.json({
      success: true,
      data: courses,
      count: Object.keys(courses).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/courses/{courseId}:
 *   get:
 *     summary: Get specific course
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course retrieved successfully
 *       404:
 *         description: Course not found
 */

router.get("/:courseId", 
  authenticateFirebaseToken,
  cacheMiddleware(600),
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const course = await firebaseService.getCourse(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: "Course not found"
      });
    }
    
    const progress = await firebaseService.getUserCourseProgress(userId, courseId);
    
    res.json({
      success: true,
      data: {
        course,
        progress: progress || {
          status: 'not_enrolled',
          progress: {
            overallProgress: 0,
            completedModules: []
          }
        }
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/courses/{courseId}/enroll:
 *   post:
 *     summary: Enroll in course
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Successfully enrolled in course
 *       400:
 *         description: Already enrolled or not eligible
 */

router.post("/:courseId/enroll", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const course = await firebaseService.getCourse(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: "Course not found"
      });
    }
    
    const existingProgress = await firebaseService.getUserCourseProgress(userId, courseId);
    if (existingProgress) {
      return res.status(400).json({
        success: false,
        error: "Already enrolled in this course"
      });
    }
    
    const userRole = req.userData.permissions.role;
    if (course.targetRoles && !course.targetRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: "This course is not available for your role"
      });
    }
    
    const enrollmentId = await firebaseService.enrollInCourse(courseId, userId);
    
    res.status(201).json({
      success: true,
      data: { enrollmentId },
      message: "Successfully enrolled in course",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/courses/{courseId}/modules/{moduleId}/complete:
 *   post:
 *     summary: Complete course module
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               score:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *     responses:
 *       200:
 *         description: Module completed successfully
 */


router.post("/:courseId/modules/:moduleId/complete", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { courseId, moduleId } = req.params;
    const { score } = req.body;
    const userId = req.authenticatedUser.uid;
    
    const course = await firebaseService.getCourse(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: "Course not found"
      });
    }
    
    const module = course.modules.find(m => m.id === moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: "Module not found"
      });
    }
    
    const progress = await firebaseService.getUserCourseProgress(userId, courseId);
    if (!progress) {
      return res.status(400).json({
        success: false,
        error: "Not enrolled in this course"
      });
    }
    
    if (module.type === 'quiz' && (score === undefined || score < 0 || score > 100)) {
      return res.status(400).json({
        success: false,
        error: "Valid score is required for quiz modules"
      });
    }
    
    if (module.type === 'quiz' && module.passingScore && score < module.passingScore) {
      return res.status(400).json({
        success: false,
        error: `Failed quiz. Required score: ${module.passingScore}, Your score: ${score}`
      });
    }
    
    const updatedProgress = await firebaseService.updateCourseProgress(userId, courseId, moduleId, score);
    
    res.json({
      success: true,
      data: updatedProgress,
      message: "Module completed successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/courses/leaderboard/{period}:
 *   get:
 *     summary: Get course leaderboard
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           enum: [weekly, monthly, allTime]
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
 */


router.get("/leaderboard/:period", 
  authenticateFirebaseToken,
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { period } = req.params;
    
    if (!['weekly', 'monthly', 'allTime'].includes(period)) {
      return res.status(400).json({
        success: false,
        error: "Invalid period. Must be one of: weekly, monthly, allTime"
      });
    }
    
    const leaderboard = await firebaseService.getCourseLeaderboard(period);
    
    res.json({
      success: true,
      data: leaderboard,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/courses/create:
 *   post:
 *     summary: Create new course (requires level 7+ permission)
 *     tags: [Courses]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - department
 *               - modules
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               department:
 *                 type: string
 *               targetRoles:
 *                 type: array
 *                 items:
 *                   type: string
 *               difficulty:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced]
 *               modules:
 *                 type: array
 *                 items:
 *                   type: object
 *               rewards:
 *                 type: object
 *     responses:
 *       201:
 *         description: Course created successfully
 */

router.post("/create", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { title, description, department, targetRoles, difficulty, modules, rewards } = req.body;
    const createdBy = req.authenticatedUser.uid;
    
    if (!title || !description || !department || !modules || !Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Title, description, department, and at least one module are required"
      });
    }
    
    const courseRef = firebaseService.db.ref('/courses/courses').push();
    
    const courseData = {
      id: courseRef.key,
      title,
      description,
      department,
      targetRoles: targetRoles || [],
      difficulty: difficulty || 'beginner',
      estimatedDuration: modules.reduce((total, module) => total + (module.content?.duration || 600), 0),
      modules: modules.map((module, index) => ({
        ...module,
        id: module.id || `module_${index + 1}`,
        order: module.order || index + 1
      })),
      rewards: rewards || {
        xp: 100,
        badge: null,
        certificate: false
      },
      analytics: {
        enrollments: 0,
        completions: 0,
        averageScore: 0,
        averageTime: 0
      },
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await courseRef.set(courseData);
    
    res.status(201).json({
      success: true,
      data: { courseId: courseRef.key },
      message: "Course created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
