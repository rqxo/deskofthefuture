/**
 * @swagger
 * tags:
 *   name: Assignments
 *   description: Assignment and quota management operations
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { CACHE_DURATIONS } from "../utils/constants.js";
import admin from 'firebase-admin';

const router = Router();
const db = admin.database();

// Helper function to get start of current week (Sunday)
function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     WeeklyQuota:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique quota identifier
 *         title:
 *           type: string
 *           description: Quota display name
 *         current:
 *           type: integer
 *           description: Current progress count
 *         required:
 *           type: integer
 *           description: Required count to complete quota
 *         completed:
 *           type: boolean
 *           description: Whether quota is completed
 *         type:
 *           type: string
 *           enum: [sessions_attended, shifts_completed, sessions_hosted, tasks_completed]
 *           description: Type of quota
 *     
 *     Assignment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique assignment identifier
 *         title:
 *           type: string
 *           description: Assignment title
 *         description:
 *           type: string
 *           description: Assignment description
 *         assignedTo:
 *           type: string
 *           description: UUID of assigned user
 *         assignedBy:
 *           type: string
 *           description: UUID of assigning user
 *         dueDate:
 *           type: integer
 *           description: Unix timestamp of due date
 *         status:
 *           type: string
 *           enum: [pending, in_progress, under_review, completed]
 *           description: Current assignment status
 *         priority:
 *           type: string
 *           enum: [low, medium, high]
 *           description: Assignment priority level
 *         createdAt:
 *           type: integer
 *           description: Unix timestamp when created
 *         updatedAt:
 *           type: integer
 *           description: Unix timestamp when last updated
 *       required:
 *         - title
 *         - description
 *         - assignedTo
 *         - assignedBy
 *         - dueDate
 *         - status
 */

/**
 * @swagger
 * /api/assignments/quotas:
 *   get:
 *     summary: Get user's weekly quotas with auto-calculation
 *     description: Calculates weekly quotas based on actual user activity data from Firebase
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Weekly quotas retrieved and calculated successfully
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
 *                         $ref: '#/components/schemas/WeeklyQuota'
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get("/quotas", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    
    // Calculate quotas based on actual data
    const quotas = [];
    const weekStart = getWeekStart();
    
    try {
      // 1. Sessions Attended - count from sessions attendance
      const sessionsSnapshot = await db.ref('sessions/sessions').once('value');
      let sessionsAttended = 0;
      
      if (sessionsSnapshot.exists()) {
        sessionsSnapshot.forEach(child => {
          const session = child.val();
          if (session.attendance && session.attendance[userId]) {
            // Check if session was this week
            const sessionDate = new Date(session.schedule?.startTime * 1000);
            if (sessionDate >= weekStart) {
              sessionsAttended++;
            }
          }
        });
      }
      
      quotas.push({
        id: 'sessions_attended',
        title: 'Sessions Attended',
        current: sessionsAttended,
        required: 5,
        completed: sessionsAttended >= 5,
        type: 'sessions_attended'
      });
      
      // 2. Shifts Completed - count from sessions where user was host
      const shiftsSnapshot = await db.ref('sessions/sessions').once('value');
      let shiftsCompleted = 0;
      
      if (shiftsSnapshot.exists()) {
        shiftsSnapshot.forEach(child => {
          const session = child.val();
          if (session.host?.primary === userId && session.status === 'completed') {
            const sessionDate = new Date(session.schedule?.startTime * 1000);
            if (sessionDate >= weekStart) {
              shiftsCompleted++;
            }
          }
        });
      }
      
      quotas.push({
        id: 'shifts_completed',
        title: 'Shifts Completed',
        current: shiftsCompleted,
        required: 6,
        completed: shiftsCompleted >= 6,
        type: 'shifts_completed'
      });
      
      // 3. Tasks Completed - count from assignments
      const assignmentsSnapshot = await db.ref('assignments/tasks')
        .orderByChild('assignedTo')
        .equalTo(userId)
        .once('value');
      
      let tasksCompleted = 0;
      if (assignmentsSnapshot.exists()) {
        assignmentsSnapshot.forEach(child => {
          const assignment = child.val();
          if (assignment.status === 'completed' && assignment.updatedAt) {
            const completedDate = new Date(assignment.updatedAt * 1000);
            if (completedDate >= weekStart) {
              tasksCompleted++;
            }
          }
        });
      }
      
      quotas.push({
        id: 'tasks_completed',
        title: 'Tasks Completed',
        current: tasksCompleted,
        required: 4,
        completed: tasksCompleted >= 4,
        type: 'tasks_completed'
      });
      
      // 4. Sessions Hosted - count sessions where user was primary host
      let sessionsHosted = 0;
      if (shiftsSnapshot.exists()) {
        shiftsSnapshot.forEach(child => {
          const session = child.val();
          if (session.host?.primary === userId) {
            const sessionDate = new Date(session.schedule?.startTime * 1000);
            if (sessionDate >= weekStart) {
              sessionsHosted++;
            }
          }
        });
      }
      
      quotas.push({
        id: 'sessions_hosted',
        title: 'Sessions Hosted',
        current: sessionsHosted,
        required: 2,
        completed: sessionsHosted >= 2,
        type: 'sessions_hosted'
      });
      
    } catch (error) {
      console.error('Error calculating quotas:', error);
      // Return empty quotas on error
    }
    
    res.json({
      success: true,
      data: quotas,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/assignments/leaderboard:
 *   get:
 *     summary: Get department-specific assignments leaderboard
 *     description: Retrieves leaderboard filtered by user's department with real-time quota and assignment calculations
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Maximum number of leaderboard entries to return
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by specific department (auto-detected if not provided)
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
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
 *                           quotaPercentage:
 *                             type: integer
 *                           assignmentsCompleted:
 *                             type: integer
 *                           totalAssignments:
 *                             type: integer
 *                           rank:
 *                             type: integer
 *                           department:
 *                             type: string
 *       401:
 *         description: Authentication required
 */
router.get("/leaderboard", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { limit = 10, department } = req.query;
    const requestingUserId = req.authenticatedUser.uid;
    
    // Get requesting user's primary department if not specified
    let targetDepartment = department;
    if (!targetDepartment) {
      const userSnapshot = await db.ref(`users/${requestingUserId}/onboarding/primaryDepartment`).once('value');
      targetDepartment = userSnapshot.exists() ? userSnapshot.val() : null;
      
      // If no primary department set, return empty leaderboard
      if (!targetDepartment) {
        return res.json({
          success: true,
          data: [],
          meta: {
            department: null,
            totalUsers: 0,
            returned: 0,
            message: "No primary department set for user"
          },
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Get all users and filter by primary department
    const usersSnapshot = await db.ref('users').once('value');
    const leaderboard = [];
    
    if (usersSnapshot.exists()) {
      const users = usersSnapshot.val();
      
      for (const userId of Object.keys(users)) {
        const userData = users[userId];
        
        // Filter by primary department from onboarding data
        const userPrimaryDept = userData.onboarding?.primaryDepartment;
        if (userPrimaryDept !== targetDepartment) {
          continue;
        }
        
        try {
          // Get user's assignments
          const assignmentsSnapshot = await db.ref('assignments/tasks')
            .orderByChild('assignedTo')
            .equalTo(userId)
            .once('value');
          
          let totalAssignments = 0;
          let completedAssignments = 0;
          
          if (assignmentsSnapshot.exists()) {
            assignmentsSnapshot.forEach(child => {
              const assignment = child.val();
              totalAssignments++;
              if (assignment.status === 'completed') {
                completedAssignments++;
              }
            });
          }
          
          // Calculate quota percentage (simplified calculation)
          const weekStart = getWeekStart();
          
          // Count sessions attended
          const sessionsSnapshot = await db.ref('sessions/sessions').once('value');
          let sessionsAttended = 0;
          let sessionsHosted = 0;
          
          if (sessionsSnapshot.exists()) {
            sessionsSnapshot.forEach(child => {
              const session = child.val();
              const sessionDate = new Date(session.schedule?.startTime * 1000);
              
              if (sessionDate >= weekStart) {
                if (session.attendance && session.attendance[userId]) {
                  sessionsAttended++;
                }
                if (session.host?.primary === userId) {
                  sessionsHosted++;
                }
              }
            });
          }
          
          // Count completed tasks this week
          let tasksCompletedThisWeek = 0;
          if (assignmentsSnapshot.exists()) {
            assignmentsSnapshot.forEach(child => {
              const assignment = child.val();
              if (assignment.status === 'completed' && assignment.updatedAt) {
                const completedDate = new Date(assignment.updatedAt * 1000);
                if (completedDate >= weekStart) {
                  tasksCompletedThisWeek++;
                }
              }
            });
          }
          
          // Calculate overall quota percentage
          const quotaScores = [
            Math.min((sessionsAttended / 5) * 100, 100), // Sessions attended
            Math.min((sessionsHosted / 2) * 100, 100),   // Sessions hosted
            Math.min((tasksCompletedThisWeek / 4) * 100, 100) // Tasks completed
          ];
          
          const averageQuotaPercentage = Math.round(
            quotaScores.reduce((sum, score) => sum + score, 0) / quotaScores.length
          );
          
          leaderboard.push({
            userUuid: userId,
            quotaPercentage: averageQuotaPercentage,
            assignmentsCompleted: completedAssignments,
            totalAssignments: totalAssignments,
            department: userPrimaryDept
          });
          
        } catch (error) {
          console.error(`Error calculating stats for user ${userId}:`, error);
          // Skip this user if there's an error
          continue;
        }
      }
    }
    
    // Sort by quota percentage (highest first), then by assignments completed
    leaderboard.sort((a, b) => {
      if (b.quotaPercentage !== a.quotaPercentage) {
        return b.quotaPercentage - a.quotaPercentage;
      }
      return b.assignmentsCompleted - a.assignmentsCompleted;
    });
    
    // Add rank numbers and limit results
    const limitedLeaderboard = leaderboard.slice(0, parseInt(limit)).map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
    
    res.json({
      success: true,
      data: limitedLeaderboard,
      meta: {
        department: targetDepartment,
        totalUsers: leaderboard.length,
        returned: limitedLeaderboard.length
      },
      timestamp: new Date().toISOString()
    });
  })
);


/**
 * @swagger
 * /api/assignments/user:
 *   get:
 *     summary: Get user's assignments
 *     description: Retrieve all assignments assigned to the current user, sorted by due date
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, under_review, completed]
 *         description: Filter assignments by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of assignments to return
 *     responses:
 *       200:
 *         description: User assignments retrieved successfully
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
 *                         $ref: '#/components/schemas/Assignment'
 *       401:
 *         description: Authentication required
 */
router.get("/user", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { status, limit = 50 } = req.query;
    
    const snapshot = await db.ref('assignments/tasks')
      .orderByChild('assignedTo')
      .equalTo(userId)
      .once('value');
    
    const assignments = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const assignment = {
          id: child.key,
          ...child.val()
        };
        
        // Filter by status if specified
        if (!status || assignment.status === status) {
          assignments.push(assignment);
        }
      });
    }
    
    // Sort by due date (earliest first)
    assignments.sort((a, b) => a.dueDate - b.dueDate);
    
    // Limit results
    const limitedAssignments = assignments.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: limitedAssignments,
      meta: {
        total: assignments.length,
        returned: limitedAssignments.length,
        filtered: status ? `status: ${status}` : 'none'
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/assignments/{assignmentId}/status:
 *   patch:
 *     summary: Update assignment status with proper workflow validation
 *     description: Updates assignment status following proper workflow (pending → in_progress → under_review → completed)
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Assignment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, in_progress, under_review, completed]
 *                 description: New status for the assignment
 *             required:
 *               - status
 *     responses:
 *       200:
 *         description: Assignment status updated successfully
 *       400:
 *         description: Invalid status transition
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Not authorized to update this assignment
 *       404:
 *         description: Assignment not found
 */
router.patch("/:assignmentId/status", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { assignmentId } = req.params;
    const { status } = req.body;
    const userId = req.authenticatedUser.uid;
    const userPermissionLevel = req.userData?.permissions?.level || 0;
    
    // Verify assignment exists
    const assignmentSnapshot = await db.ref(`assignments/tasks/${assignmentId}`).once('value');
    
    if (!assignmentSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Assignment not found"
      });
    }
    
    const assignment = assignmentSnapshot.val();
    
    // Check authorization
    const isAssignedUser = assignment.assignedTo === userId;
    const isManager = userPermissionLevel >= 5; // Managers can update any assignment
    
    if (!isAssignedUser && !isManager) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this assignment"
      });
    }
    
    // Define valid status transitions
    const validTransitions = {
      'pending': ['in_progress'],
      'in_progress': ['under_review', 'pending'], // Can go back to pending
      'under_review': ['completed', 'in_progress'], // Managers can approve or send back
      'completed': [] // Cannot change completed status
    };
    
    // Additional restrictions for regular users vs managers
    if (!isManager && isAssignedUser) {
      // Regular users can only progress forward or go back one step
      if (assignment.status === 'under_review' && status !== 'in_progress') {
        return res.status(403).json({
          success: false,
          error: "Only managers can approve assignments"
        });
      }
    }
    
    // Validate status transition
    if (!validTransitions[assignment.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition from ${assignment.status} to ${status}`
      });
    }
    
    // Update assignment status
    const updateData = {
      status: status,
      updatedAt: Math.floor(Date.now() / 1000)
    };
    
    // Add completion timestamp if marking as completed
    if (status === 'completed') {
      updateData.completedAt = Math.floor(Date.now() / 1000);
      updateData.completedBy = userId;
    }
    
    await db.ref(`assignments/tasks/${assignmentId}`).update(updateData);
    
    res.json({
      success: true,
      message: "Assignment status updated successfully",
      data: {
        assignmentId,
        oldStatus: assignment.status,
        newStatus: status,
        updatedBy: userId
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/assignments:
 *   post:
 *     summary: Create a new assignment
 *     description: Create a new assignment (requires level 4+ permission)
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 200
 *                 description: Assignment title
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *                 description: Assignment description
 *               assignedTo:
 *                 type: string
 *                 description: UUID of user to assign to
 *               dueDate:
 *                 type: integer
 *                 description: Unix timestamp of due date
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 default: medium
 *                 description: Assignment priority level
 *             required:
 *               - title
 *               - description
 *               - assignedTo
 *               - dueDate
 *     responses:
 *       201:
 *         description: Assignment created successfully
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
 *                         assignmentId:
 *                           type: string
 *                           description: ID of the created assignment
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", 
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { title, description, assignedTo, dueDate, priority = 'medium' } = req.body;
    const assignedBy = req.authenticatedUser.uid;
    
    // Validate required fields
    if (!title || !description || !assignedTo || !dueDate) {
      return res.status(400).json({
        success: false,
        error: "Title, description, assignedTo, and dueDate are required"
      });
    }
    
    // Validate due date is in the future
    const now = Math.floor(Date.now() / 1000);
    if (dueDate <= now) {
      return res.status(400).json({
        success: false,
        error: "Due date must be in the future"
      });
    }
    
    // Verify assigned user exists
    const userSnapshot = await db.ref(`users/${assignedTo}`).once('value');
    if (!userSnapshot.exists()) {
      return res.status(400).json({
        success: false,
        error: "Assigned user does not exist"
      });
    }
    
    const assignmentData = {
      title: title.trim(),
      description: description.trim(),
      assignedTo,
      assignedBy,
      dueDate,
      priority,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    
    const assignmentRef = await db.ref('assignments/tasks').push(assignmentData);
    
    res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      data: {
        assignmentId: assignmentRef.key
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/assignments/{assignmentId}:
 *   delete:
 *     summary: Delete an assignment
 *     description: Delete an assignment (requires level 6+ permission or being the creator)
 *     tags: [Assignments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Assignment ID
 *     responses:
 *       200:
 *         description: Assignment deleted successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Assignment not found
 */
router.delete("/:assignmentId",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { assignmentId } = req.params;
    const userId = req.authenticatedUser.uid;
    const userPermissionLevel = req.userData?.permissions?.level || 0;
    
    // Check if assignment exists
    const assignmentSnapshot = await db.ref(`assignments/tasks/${assignmentId}`).once('value');
    
    if (!assignmentSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Assignment not found"
      });
    }
    
    const assignment = assignmentSnapshot.val();
    
    // Check permissions: level 6+ or creator can delete
    if (userPermissionLevel < 6 && assignment.assignedBy !== userId) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to delete this assignment"
      });
    }
    
    await db.ref(`assignments/tasks/${assignmentId}`).remove();
    
    res.json({
      success: true,
      message: "Assignment deleted successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
