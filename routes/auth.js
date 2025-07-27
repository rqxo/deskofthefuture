/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication and session management
 */

import { Router } from "express";
import passport from "../config/passport.js";
import rateLimit from "express-rate-limit";
import admin from "../config/firebase.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { sessions } from "../server.js";

const router = Router();
const firebaseService = new FirebaseService();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many authentication attempts" }
});

function notifyFrontend(sessionId, payload) {
  const ws = sessions.get(sessionId);
  console.log(sessions)
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
    sessions.delete(sessionId);
  }
}

function extractSessionId(req, res, next) {
  const sessionId = req.query.sessionId;
  if (sessionId) req.sessionId = sessionId;
  next();
}

/**
 * @swagger
 * /api/auth/discord:
 *   get:
 *     summary: Initiate Discord OAuth authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: false
 *         description: Session ID for websocket communication
 *     responses:
 *       302:
 *         description: Redirects to Discord OAuth
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/discord",
  authLimiter,
  extractSessionId,
  async (req, res, next) => {
    const { token } = req.query;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.firebaseUid = decoded.uid;
      // Store UID in session or state for callback
      req.session.firebaseUid = decoded.uid;
      next();
    } catch {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
  },
  (req, res, next) => {
    passport.authenticate("discord", {
      state: req.sessionId || undefined,
      scope: ["identify"]
    })(req, res, next);
  }
);

/**
 * @swagger
 * /api/auth/discord/callback:
 *   get:
 *     summary: OAuth callback handler for Discord authentication
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to success or error page
 */
router.get(
  "/discord/callback",
  authLimiter,
  passport.authenticate("discord", {
    failureRedirect: "/api/auth/discord/error",
    session: false
  }),
  asyncHandler(async (req, res) => {
    const firebaseUid = req.session.firebaseUid;
    const sessionId = req.query.state

    if (!firebaseUid) {
      if (sessionId) {
        notifyFrontend(sessionId, {
          type: "DISCORD_AUTH",
          error: "No logged-in user"
        });
      }
      return res.status(401).json({ success: false, error: "No logged-in user" });
    }

    const { id: discordId, username, avatar } = req.user.discord;

    // Update the existing user
    await admin.database().ref(`users/${firebaseUid}/profile/discordId`).set(discordId);
    await admin.database().ref(`users/${firebaseUid}/profile/discordUsername`).set(username);
    await admin.database().ref(`users/${firebaseUid}/profile/discordAvatar`).set(avatar);

    // Notify frontend via websocket/sessionId
    if (sessionId) {
      notifyFrontend(sessionId, {
        type: "DISCORD_AUTH",
        success: true,
        user: {
          discordId,
          username,
          avatar
        }
      });
    }

    res.redirect("http://localhost:3000/auth/discord/callback");
  })
);

/**
 * @swagger
 * /api/auth/discord/success:
 *   get:
 *     summary: Successful Discord authentication response
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Authentication successful
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
 *                         user:
 *                           type: object
 *                           properties:
 *                             discordId:
 *                               type: string
 *                             username:
 *                               type: string
 *                             avatar:
 *                               type: string
 *                         firebaseToken:
 *                           type: string
 */
router.get("/discord/success", asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed"
    });
  }

  const { discord, firebasetoken } = req.user;

  await firebaseService.updateUser(discord.id, {
    "activity/lastSeen": Date.now()
  });

  res.json({
    success: true,
    message: "Authentication successful",
    data: {
      user: {
        discordId: discord.id,
        username: discord.username,
        avatar: discord.avatar
      },
      firebaseToken: firebasetoken
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * @swagger
 * /api/auth/discord/error:
 *   get:
 *     summary: Discord authentication error redirect
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to frontend error page
 */
router.get("/discord/error", (req, res) => {
  res.redirect("http://localhost:3000/auth/discord/callback");
});

/**
 * @swagger
 * /api/auth/roblox:
 *   get:
 *     summary: Initiate Roblox OAuth authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         required: false
 *         description: Session ID for websocket communication
 *     responses:
 *       302:
 *         description: Redirects to Roblox OAuth
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/roblox",
  authLimiter,
  extractSessionId,
  (req, res, next) => {
    passport.authenticate("openidconnect", {
      state: req.sessionId || undefined
    })(req, res, next);
  }
);

/**
 * @swagger
 * /api/auth/roblox/callback:
 *   get:
 *     summary: OAuth callback handler for Roblox authentication
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to success or error page
 */
router.get(
  "/roblox/callback",
  authLimiter,
  passport.authenticate("openidconnect", {
    failureRedirect: "/api/auth/roblox/error",
    session: false
  }),
  (req, res) => {
    const sessionId = req.authInfo.state;
    if (!req.user) {
      if (sessionId) {
        notifyFrontend(sessionId, {
          type: "ROBLOX_AUTH",
          error: "Authentication failed"
        });
      }
      return res.redirect("/api/auth/roblox/error");
    }
    const { roblox, firebasetoken } = req.user;
    if (sessionId) {
      notifyFrontend(sessionId, {
        type: "ROBLOX_AUTH",
        token: firebasetoken,
        user: {
          robloxId: roblox.sub,
          username: roblox.preferred_username,
          displayName: roblox.name,
          avatarUrl: roblox.picture
        }
      });
    }
    res.redirect("http://localhost:3000/auth/roblox/callback");
  }
);

/**
 * @swagger
 * /api/auth/roblox/success:
 *   get:
 *     summary: Successful authentication response
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Authentication successful
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
 *                         user:
 *                           type: object
 *                           properties:
 *                             robloxId:
 *                               type: string
 *                             username:
 *                               type: string
 *                             displayName:
 *                               type: string
 *                             avatarUrl:
 *                               type: string
 *                         firebaseToken:
 *                           type: string
 */
router.get("/roblox/success", asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed"
    });
  }

  const { roblox, firebase, firebasetoken } = req.user;
  
  await firebaseService.updateUser(roblox.sub, {
    "activity/lastSeen": Date.now()
  });

  res.json({
    success: true,
    message: "Authentication successful",
    data: {
      user: {
        robloxId: roblox.sub,
        username: roblox.preferred_username,
        displayName: roblox.name,
        avatarUrl: roblox.picture
      },
      firebaseToken: firebasetoken
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * @swagger
 * /api/auth/roblox/error:
 *   get:
 *     summary: Roblox authentication error redirect
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to frontend error page
 */
router.get("/roblox/error", (req, res) => {
  res.redirect("http://localhost:3000/auth/roblox/callback");
});

/**
 * @swagger
 * /api/auth/verify-token:
 *   post:
 *     summary: Verify Firebase JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Firebase JWT token
 *     responses:
 *       200:
 *         description: Token is valid
 *       401:
 *         description: Invalid token
 */
router.post("/verify-token", asyncHandler(async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({
      success: false,
      error: "Token is required"
    });
  }
  
  const decodedToken = await admin.auth().verifyIdToken(token);
  const userData = await firebaseService.getUser(decodedToken.uid);
  
  res.json({
    success: true,
    data: {
      valid: true,
      user: userData,
      uid: decodedToken.uid
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out current user
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: "Error during logout"
      });
    }
    
    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        console.error('Session destruction error:', sessionErr);
      }
      
      res.clearCookie('connect.sid');
      res.json({
        success: true,
        message: "Logged out successfully",
        timestamp: new Date().toISOString()
      });
    });
  });
});

router.get(
  "/perId/:uid",
  asyncHandler(async (req, res) => {
    const { uid } = req.params;
    const userRecord = await admin.auth().getUser(uid);
    res.json({
      success: true,
      data: { email: userRecord.email },
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
