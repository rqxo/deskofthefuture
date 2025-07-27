/**
 * @swagger
 * tags:
 *   name: Sessions
 *   description: Training and event session management
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import rateLimit from "express-rate-limit";

const router = Router();
const firebaseService = new FirebaseService();

const playerCountLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 4, // Allows polling every 15 seconds
  message: {
    success: false,
    error: "Too many requests to player count. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /api/sessions/roblox/player-count/{universeId}:
 *   get:
 *     summary: Get Roblox game player count
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: universeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Roblox universe ID
 *     responses:
 *       200:
 *         description: Player count retrieved successfully
 *       404:
 *         description: Game not found
 *       500:
 *         description: Error fetching player count
 */
router.get("/roblox/player-count/:universeId", 
  authenticateFirebaseToken,
  cacheMiddleware(60),
  playerCountLimiter,
  asyncHandler(async (req, res) => {
    const { universeId } = req.params;
    
    try {
      const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
      
      if (!response.ok) {
        throw new Error(`Roblox API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Game not found",
          timestamp: new Date().toISOString()
        });
      }
      
      const playerCount = data.data[0].playing || 0;
      
      res.json({
        success: true,
        data: {
          playerCount,
          universeId,
          gameData: {
            name: data.data[0].name,
            description: data.data[0].description,
            creator: data.data[0].creator,
            rootPlaceId: data.data[0].rootPlaceId,
            created: data.data[0].created,
            updated: data.data[0].updated
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Error fetching player count for universe ${universeId}:`, error);
      
      res.status(500).json({
        success: false,
        error: "Failed to fetch player count",
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/sessions/daily-count/{gameId}:
 *   get:
 *     summary: Get daily session count for a game
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *         description: Game ID (bakery-main or sessions-center)
 *     responses:
 *       200:
 *         description: Daily session count retrieved successfully
 *       404:
 *         description: Game not found
 */
router.get("/daily-count/:gameId", 
  authenticateFirebaseToken,
  cacheMiddleware(300), // Cache for 5 minutes
  asyncHandler(async (req, res) => {
    const { gameId } = req.params;
    
    try {
      // Validate gameId
      if (!['bakery-main', 'sessions-center'].includes(gameId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid gameId. Must be 'bakery-main' or 'sessions-center'",
          timestamp: new Date().toISOString()
        });
      }

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      
      // Initialize database path if it doesn't exist
      const gameRef = firebaseService.db.ref(`games/${gameId}`);
      const gameSnapshot = await gameRef.once('value');
      
      if (!gameSnapshot.exists()) {
        // Create the game structure if it doesn't exist
        await gameRef.set({
          dailySessions: {
            count: 0,
            lastUpdated: Date.now()
          },
          staff: {
            staff: 0,
            customers: 0
          }
        });
        console.log(`Created database structure for ${gameId}`);
      } else {
        // Check if dailySessions exists
        const dailySessionsRef = firebaseService.db.ref(`games/${gameId}/dailySessions`);
        const dailySessionsSnapshot = await dailySessionsRef.once('value');
        
        if (!dailySessionsSnapshot.exists()) {
          // Create dailySessions structure if it doesn't exist
          await dailySessionsRef.set({
            count: 0,
            lastUpdated: Date.now()
          });
          console.log(`Created dailySessions structure for ${gameId}`);
        }
      }
      
      // Query sessions for today
      const snapshot = await firebaseService.db.ref('/sessions/sessions')
        .orderByChild('schedule/startTime')
        .startAt(new Date(today).getTime())
        .endAt(new Date(today + 'T23:59:59.999Z').getTime())
        .once('value');
      
      let count = 0;
      snapshot.forEach(child => {
        const session = child.val();
        // Filter by game type
        if ((gameId === 'bakery-main' && session.type === 'shift') ||
            (gameId === 'sessions-center' && session.type === 'training')) {
          count++;
        }
      });
      
      // Update the count in the database
      await firebaseService.db.ref(`games/${gameId}/dailySessions`).update({
        count: count,
        lastUpdated: Date.now(),
        date: today
      });
      
      res.json({
        success: true,
        data: {
          gameId,
          date: today,
          count
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Error fetching daily session count for ${gameId}:`, error);
      
      res.status(500).json({
        success: false,
        error: "Failed to fetch daily session count",
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/sessions/initialize-game-data:
 *   post:
 *     summary: Initialize game data structures in database
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Game data structures initialized successfully
 */
router.post("/initialize-game-data", 
  authenticateFirebaseToken,
  requirePermission(3), // Require level 3+ permission
  asyncHandler(async (req, res) => {
    try {
      const gameIds = ['bakery-main', 'sessions-center'];
      const initResults = [];

      for (const gameId of gameIds) {
        const gameRef = firebaseService.db.ref(`games/${gameId}`);
        const gameSnapshot = await gameRef.once('value');
        
        if (!gameSnapshot.exists()) {
          // Create the complete game structure
          await gameRef.set({
            dailySessions: {
              count: 0,
              lastUpdated: Date.now(),
              date: new Date().toISOString().split('T')[0]
            },
            staff: {
              staff: 0,
              customers: 0
            }
          });
          initResults.push(`Created complete structure for ${gameId}`);
        } else {
          // Check and create missing parts
          const updates = {};
          
          // Check dailySessions
          const dailySessionsSnapshot = await gameRef.child('dailySessions').once('value');
          if (!dailySessionsSnapshot.exists()) {
            updates['dailySessions'] = {
              count: 0,
              lastUpdated: Date.now(),
              date: new Date().toISOString().split('T')[0]
            };
          }
          
          // Check staff
          const staffSnapshot = await gameRef.child('staff').once('value');
          if (!staffSnapshot.exists()) {
            updates['staff'] = {
              staff: 0,
              customers: 0
            };
          }
          
          if (Object.keys(updates).length > 0) {
            await gameRef.update(updates);
            initResults.push(`Updated missing structures for ${gameId}: ${Object.keys(updates).join(', ')}`);
          } else {
            initResults.push(`${gameId} already has complete structure`);
          }
        }
      }

      res.json({
        success: true,
        data: {
          results: initResults
        },
        message: "Game data structures initialized successfully",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error initializing game data:', error);
      
      res.status(500).json({
        success: false,
        error: "Failed to initialize game data",
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/sessions:
 *   get:
 *     summary: Get all sessions
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sessions retrieved successfully
 *   post:
 *     summary: Create new session (requires level 3+ permission)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Session created successfully
 */
router.get("/", 
  authenticateFirebaseToken,
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { type, department, status, date } = req.query;
    
    const filters = { type, department, status, date };
    const sessions = await firebaseService.getSessions(filters);
    
    res.json({
      success: true,
      data: sessions,
      count: Object.keys(sessions).length,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/", 
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { type, title, description, department, schedule, capacity, requirements, rewards } = req.body;
    const createdBy = req.authenticatedUser.uid;
    
    if (!type || !title || !description || !department || !schedule) {
      return res.status(400).json({
        success: false,
        error: "Type, title, description, department, and schedule are required"
      });
    }
    
    const userDepartment = req.userData.permissions.department;
    if (department !== userDepartment && req.userData.permissions.level < 7) {
      return res.status(403).json({
        success: false,
        error: "You can only create sessions for your department"
      });
    }
    
    const sessionData = {
      type,
      title,
      description,
      department,
      host: {
        primary: createdBy,
        backup: null
      },
      schedule,
      capacity: capacity || {
        min: 3,
        max: 15
      },
      requirements: requirements || {
        minLevel: 1,
        departments: []
      },
      rewards: rewards || {
        hostXP: 50,
        attendeeXP: 25
      }
    };
    
    const sessionId = await firebaseService.createSession(sessionData, createdBy);
    
    // Update daily session count after creating a session
    try {
      const gameId = type === 'shift' ? 'bakery-main' : 'sessions-center';
      const today = new Date().toISOString().split('T')[0];
      
      // Get current count and increment
      const dailySessionsRef = firebaseService.db.ref(`games/${gameId}/dailySessions`);
      const currentSnapshot = await dailySessionsRef.once('value');
      
      if (currentSnapshot.exists()) {
        const currentData = currentSnapshot.val();
        const newCount = (currentData.count || 0) + 1;
        
        await dailySessionsRef.update({
          count: newCount,
          lastUpdated: Date.now(),
          date: today
        });
      } else {
        // Create the structure if it doesn't exist
        await dailySessionsRef.set({
          count: 1,
          lastUpdated: Date.now(),
          date: today
        });
      }
    } catch (error) {
      console.error('Error updating daily session count:', error);
      // Don't fail the session creation if count update fails
    }
    
    res.status(201).json({
      success: true,
      data: { sessionId },
      message: "Session created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/current:
 *   get:
 *     summary: Get current active session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [training, interview, shift]
 *         description: Filter by session type
 *     responses:
 *       200:
 *         description: Current session retrieved successfully
 *       404:
 *         description: No active session found
 */
router.get("/current", 
  authenticateFirebaseToken,
  cacheMiddleware(60),
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    const now = Date.now();
    
    // Find current session (where start time < now < end time)
    const currentSessionSnapshot = await firebaseService.db.ref('/sessions/sessions')
      .orderByChild('schedule/startTime')
      .endAt(now)
      .limitToLast(10) // Get more results to filter properly
      .once('value');
    
    // Find next upcoming session
    const nextSessionSnapshot = await firebaseService.db.ref('/sessions/sessions')
      .orderByChild('schedule/startTime')
      .startAt(now)
      .limitToFirst(10) // Get more results to filter properly
      .once('value');
    
    const currentSessions = [];
    currentSessionSnapshot.forEach(child => {
      const session = child.val();
      if (session.schedule.endTime > now && (!type || session.type === type)) {
        currentSessions.push({
          id: child.key,
          ...session
        });
      }
    });
    
    const nextSessions = [];
    nextSessionSnapshot.forEach(child => {
      const session = child.val();
      if (!type || session.type === type) {
        nextSessions.push({
          id: child.key,
          ...session
        });
      }
    });
    
    // Sort and get the most recent current session
    currentSessions.sort((a, b) => b.schedule.startTime - a.schedule.startTime);
    const currentSession = currentSessions.length > 0 ? currentSessions[0] : null;
    
    // Sort and get the earliest next session
    nextSessions.sort((a, b) => a.schedule.startTime - b.schedule.startTime);
    const nextSession = nextSessions.length > 0 ? 
      (currentSession && nextSessions[0].id === currentSession.id ? 
        (nextSessions.length > 1 ? nextSessions[1] : null) : nextSessions[0]) : null;
    
    if (!currentSession && !nextSession) {
      return res.status(404).json({
        success: false,
        error: type ? `No current or upcoming ${type} sessions found` : "No current or upcoming sessions found",
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      data: {
        currentSession,
        nextSession
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/next:
 *   get:
 *     summary: Get next upcoming session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [training, interview, shift]
 *         description: Filter by session type
 *     responses:
 *       200:
 *         description: Next session retrieved successfully
 *       404:
 *         description: No upcoming sessions found
 */
router.get("/next", 
  authenticateFirebaseToken,
  cacheMiddleware(120),
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    const now = Date.now();
    
    const snapshot = await firebaseService.db.ref('/sessions/sessions')
      .orderByChild('schedule/startTime')
      .startAt(now)
      .once('value');
    
    const sessions = [];
    snapshot.forEach(child => {
      const session = child.val();
      
      if (!type || session.type === type) {
        sessions.push({
          id: child.key,
          ...session
        });
      }
    });
    
    // Sort by start time and get the first one
    sessions.sort((a, b) => a.schedule.startTime - b.schedule.startTime);
    
    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        error: type ? `No upcoming ${type} sessions found` : "No upcoming sessions found",
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      data: sessions[0],
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/availability/my:
 *   get:
 *     summary: Get user's availability
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Availability retrieved successfully
 */
router.get("/availability/my", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    
    const availability = await firebaseService.getUserAvailability(userId);
    
    res.json({
      success: true,
      data: availability || {
        userId,
        schedule: {},
        preferences: {
          sessionTypes: [],
          maxSessionsPerWeek: 3,
          preferredRole: "attendee"
        },
        updatedAt: null
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/availability:
 *   put:
 *     summary: Update user's availability
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Availability updated successfully
 */
router.put("/availability", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { schedule, preferences } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!schedule || typeof schedule !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Schedule object is required"
      });
    }
    
    await firebaseService.updateUserAvailability(userId, schedule, preferences);
    
    res.json({
      success: true,
      message: "Availability updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/assignments/monthly/{yearMonth}:
 *   get:
 *     summary: Get monthly session assignments (requires level 3+ permission)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: yearMonth
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}$'
 *         description: Year and month in YYYY-MM format
 *     responses:
 *       200:
 *         description: Assignments retrieved successfully
 */
router.get("/assignments/monthly/:yearMonth", 
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { yearMonth } = req.params;
    
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({
        success: false,
        error: "Invalid format. Use YYYY-MM"
      });
    }
    
    const snapshot = await firebaseService.db.ref(`/sessions/assignments/monthly/${yearMonth}`).once('value');
    const assignments = snapshot.val() || {};
    
    res.json({
      success: true,
      data: assignments,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/{sessionId}/register:
 *   post:
 *     summary: Register for session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully registered for session
 *       400:
 *         description: Session is full or not eligible
 */
router.post("/:sessionId/register", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    try {
      await firebaseService.registerForSession(sessionId, userId);
      
      res.json({
        success: true,
        message: "Successfully registered for session",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  })
);

/**
 * @swagger
 * /api/sessions/{sessionId}/complete:
 *   post:
 *     summary: Mark session as completed (requires level 3+ permission)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session marked as completed
 */
router.post("/:sessionId/complete", 
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { actualAttendees, feedback, rating } = req.body;
    const userId = req.authenticatedUser.uid;
    
    const snapshot = await firebaseService.db.ref(`/sessions/sessions/${sessionId}`).once('value');
    const session = snapshot.val();
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Session not found"
      });
    }
    
    if (session.host.primary !== userId && session.host.backup !== userId && req.userData.permissions.level < 7) {
      return res.status(403).json({
        success: false,
        error: "Only session hosts can mark sessions as completed"
      });
    }
    
    if (session.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: "Session is already marked as completed"
      });
    }
    
    const updates = {
      status: 'completed',
      "analytics/actualAttendance": actualAttendees?.length || 0,
      "analytics/completionRate": actualAttendees?.length ? (actualAttendees.length / session.capacity.current) * 100 : 0,
      "analytics/averageRating": rating || 0,
      "analytics/feedback": feedback || [],
      completedAt: Date.now(),
      completedBy: userId
    };
    
    await firebaseService.db.ref(`/sessions/sessions/${sessionId}`).update(updates);
    
    if (session.rewards) {
      if (session.host.primary) {
        await firebaseService.addUserXP(session.host.primary, session.rewards.hostXP);
      }
      
      if (session.host.backup && session.host.backup !== session.host.primary) {
        await firebaseService.addUserXP(session.host.backup, session.rewards.hostXP / 2);
      }
      
      if (actualAttendees && actualAttendees.length > 0) {
        for (const attendeeId of actualAttendees) {
          await firebaseService.addUserXP(attendeeId, session.rewards.attendeeXP);
        }
      }
    }
    
    res.json({
      success: true,
      message: "Session marked as completed",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/sessions/{sessionId}:
 *   get:
 *     summary: Get specific session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session retrieved successfully
 *       404:
 *         description: Session not found
 */
router.get("/:sessionId", 
  authenticateFirebaseToken,
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    const snapshot = await firebaseService.db.ref(`/sessions/sessions/${sessionId}`).once('value');
    const session = snapshot.val();
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Session not found"
      });
    }
    
    res.json({
      success: true,
      data: session,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
