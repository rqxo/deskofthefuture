/**
 * @swagger
 * tags:
 *   name: Partners
 *   description: Partner organization management
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
 * /api/partners:
 *   get:
 *     summary: Get all partners
 *     tags: [Partners]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, pending, inactive]
 *           default: active
 *     responses:
 *       200:
 *         description: Partners retrieved successfully
 */

router.get("/", 
  cacheMiddleware(600),
  asyncHandler(async (req, res) => {
    const { status = 'active' } = req.query;
    const partners = await firebaseService.getPartners(status);
    
    const publicPartners = {};
    Object.entries(partners).forEach(([id, partner]) => {
      publicPartners[id] = {
        id,
        name: partner.name,
        description: partner.description,
        tier: partner.tier,
        profile: {
          logo: partner.profile?.logo,
          banner: partner.profile?.banner,
          website: partner.profile?.website,
          socialLinks: partner.profile?.socialLinks,
          customization: partner.profile?.customization
        }
      };
    });
    
    res.json({
      success: true,
      data: publicPartners,
      count: Object.keys(publicPartners).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/partners/{partnerId}:
 *   get:
 *     summary: Get specific partner
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: partnerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Partner retrieved successfully
 *       404:
 *         description: Partner not found
 */

router.get("/:partnerId", 
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const partner = await firebaseService.getPartner(partnerId);
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const publicPartner = {
      id: partnerId,
      name: partner.name,
      description: partner.description,
      tier: partner.tier,
      profile: {
        logo: partner.profile?.logo,
        banner: partner.profile?.banner,
        website: partner.profile?.website,
        socialLinks: partner.profile?.socialLinks,
        customization: partner.profile?.customization
      }
    };
    
    res.json({
      success: true,
      data: publicPartner,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/partners/{partnerId}/events:
 *   get:
 *     summary: Get partner events
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: partnerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [upcoming, ongoing, past]
 *           default: upcoming
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *   post:
 *     summary: Create partner event
 *     tags: [Partners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partnerId
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
 *               - title
 *               - description
 *               - type
 *               - schedule
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *               schedule:
 *                 type: object
 *               maxCapacity:
 *                 type: integer
 *               rewards:
 *                 type: object
 *     responses:
 *       201:
 *         description: Event created successfully
 */

router.get("/:partnerId/events", 
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const { status = 'upcoming' } = req.query;
    
    const events = await firebaseService.getPartnerEvents(partnerId, status);
    
    res.json({
      success: true,
      data: events,
      count: Object.keys(events).length,
      timestamp: new Date().toISOString()
    });
  })
);


router.post("/:partnerId/events", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const { title, description, type, schedule, maxCapacity, rewards } = req.body;
    const createdBy = req.authenticatedUser.uid;
    
    const partner = await firebaseService.getPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const isRepresentative = partner.representatives.some(rep => rep.robloxId === createdBy);
    const isOwner = partner.owner.robloxId === createdBy;
    const isPR = req.userData.permissions.department === 'pr' && req.userData.permissions.level >= 4;
    
    if (!isRepresentative && !isOwner && !isPR) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to create events for this partner"
      });
    }
    
    if (!title || !description || !type || !schedule) {
      return res.status(400).json({
        success: false,
        error: "Title, description, type, and schedule are required"
      });
    }
    
    const eventData = {
      title,
      description,
      type,
      status: 'upcoming',
      schedule,
      maxCapacity: maxCapacity || 100,
      rewards
    };
    
    const eventId = await firebaseService.createPartnerEvent(partnerId, eventData, createdBy);
    
    res.status(201).json({
      success: true,
      data: { eventId },
      message: "Event created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/partners/{partnerId}/announcements:
 *   post:
 *     summary: Create partner announcement
 *     tags: [Partners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partnerId
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
 *               - title
 *               - content
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *                 default: news
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high, urgent]
 *               media:
 *                 type: object
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Announcement created successfully
 */
router.post("/:partnerId/announcements", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const { title, content, type, priority, media, expiresAt } = req.body;
    const createdBy = req.authenticatedUser.uid;
    
    const partner = await firebaseService.getPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const isRepresentative = partner.representatives.some(rep => rep.robloxId === createdBy);
    const isOwner = partner.owner.robloxId === createdBy;
    const isPR = req.userData.permissions.department === 'pr' && req.userData.permissions.level >= 4;
    
    if (!isRepresentative && !isOwner && !isPR) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to create announcements for this partner"
      });
    }
    
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required"
      });
    }
    
    const announcementData = {
      title,
      content,
      type: type || 'news',
      priority: priority || 'normal',
      targetAudience: 'all',
      media: media || { images: [], videos: [] },
      expiresAt: expiresAt || null
    };
    
    const announcementId = await firebaseService.createPartnerAnnouncement(partnerId, announcementData, createdBy);
    
    res.status(201).json({
      success: true,
      data: { announcementId },
      message: "Announcement created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/partners/{partnerId}/profile:
 *   get:
 *     summary: Get partner profile (requires authorization)
 *     tags: [Partners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partnerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Partner profile retrieved successfully
 *       403:
 *         description: Access denied
 *   put:
 *     summary: Update partner profile (requires authorization)
 *     tags: [Partners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partnerId
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
 *               - profile
 *             properties:
 *               profile:
 *                 type: object
 *     responses:
 *       200:
 *         description: Partner profile updated successfully
 */

router.get("/:partnerId/profile", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const partner = await firebaseService.getPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const isRepresentative = partner.representatives.some(rep => rep.robloxId === userId);
    const isOwner = partner.owner.robloxId === userId;
    const isPR = req.userData.permissions.department === 'pr' && req.userData.permissions.level >= 4;
    
    if (!isRepresentative && !isOwner && !isPR) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to view this partner's profile"
      });
    }
    
    res.json({
      success: true,
      data: partner,
      timestamp: new Date().toISOString()
    });
  })
);

router.put("/:partnerId/profile", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { partnerId } = req.params;
    const { profile } = req.body;
    const userId = req.authenticatedUser.uid;
    
    const partner = await firebaseService.getPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const isRepresentative = partner.representatives.some(rep => rep.robloxId === userId);
    const isOwner = partner.owner.robloxId === userId;
    const isPR = req.userData.permissions.department === 'pr' && req.userData.permissions.level >= 4;
    
    if (!isRepresentative && !isOwner && !isPR) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to update this partner's profile"
      });
    }
    
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Profile object is required"
      });
    }
    
    await firebaseService.db.ref(`/partners/organizations/${partnerId}/profile`).update(profile);
    
    res.json({
      success: true,
      message: "Partner profile updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
