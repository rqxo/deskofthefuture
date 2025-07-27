/**
 * @swagger
 * tags:
 *   name: Community
 *   description: Community management operations including announcements, events, gallery, and updates
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { CACHE_DURATIONS } from "../utils/constants.js";
import admin from 'firebase-admin';

const router = Router();
const db = admin.database();

/**
 * @swagger
 * components:
 *   schemas:
 *     Announcement:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique announcement identifier
 *         title:
 *           type: string
 *           description: Announcement title
 *         description:
 *           type: string
 *           description: Announcement content
 *         timestamp:
 *           type: integer
 *           description: Unix timestamp when announcement was created
 *         fromUserUuid:
 *           type: string
 *           description: UUID of the user who created the announcement
 *         type:
 *           type: string
 *           enum: [general, urgent, system, celebration]
 *           description: Type of announcement
 *       required:
 *         - title
 *         - description
 *         - fromUserUuid
 *     
 *     Event:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique event identifier
 *         title:
 *           type: string
 *           description: Event title
 *         description:
 *           type: string
 *           description: Event description
 *         bannerUrl:
 *           type: string
 *           format: uri
 *           description: URL to event banner image
 *         timestamp:
 *           type: integer
 *           description: Unix timestamp when event occurs
 *         location:
 *           type: string
 *           description: Event location
 *         hostUserUuid:
 *           type: string
 *           description: UUID of the event host
 *         coHosts:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of co-host user UUIDs
 *         type:
 *           type: string
 *           enum: [training, social, meeting, celebration, workshop]
 *           description: Type of event
 *       required:
 *         - title
 *         - description
 *         - timestamp
 *         - location
 *         - hostUserUuid
 *     
 *     GalleryItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique gallery item identifier
 *         title:
 *           type: string
 *           description: Gallery item title
 *         imageUrl:
 *           type: string
 *           format: uri
 *           description: URL to the image
 *         timestamp:
 *           type: integer
 *           description: Unix timestamp when item was uploaded
 *         uploadedBy:
 *           type: string
 *           description: UUID of the user who uploaded the item
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Tags associated with the gallery item
 *       required:
 *         - title
 *         - imageUrl
 *         - uploadedBy
 *     
 *     CommunityUpdate:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique update identifier
 *         type:
 *           type: string
 *           enum: [promotion, new_member, transfer, achievement, departure]
 *           description: Type of community update
 *         title:
 *           type: string
 *           description: Update title
 *         description:
 *           type: string
 *           description: Update description
 *         timestamp:
 *           type: integer
 *           description: Unix timestamp when update occurred
 *         userUuid:
 *           type: string
 *           description: UUID of the user this update is about
 *         metadata:
 *           type: object
 *           description: Additional metadata specific to update type
 *       required:
 *         - type
 *         - title
 *         - description
 *         - userUuid
 */

/**
 * @swagger
 * /api/community/announcements:
 *   get:
 *     summary: Get community announcements
 *     description: Retrieve a list of community announcements, ordered by most recent first
 *     tags: [Community]
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
 *         description: Maximum number of announcements to return
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [general, urgent, system, celebration]
 *         description: Filter announcements by type
 *     responses:
 *       200:
 *         description: Announcements retrieved successfully
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
 *                         $ref: '#/components/schemas/Announcement'
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new announcement
 *     description: Create a new community announcement (requires level 5+ permission)
 *     tags: [Community]
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
 *                 description: Announcement title
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *                 description: Announcement content
 *               type:
 *                 type: string
 *                 enum: [general, urgent, system, celebration]
 *                 default: general
 *                 description: Type of announcement
 *             required:
 *               - title
 *               - description
 *     responses:
 *       201:
 *         description: Announcement created successfully
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
 *                         announcementId:
 *                           type: string
 *                           description: ID of the created announcement
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.get("/announcements", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const { limit = 10, type } = req.query;
    
    let query = db.ref('community/announcements')
      .orderByChild('timestamp')
      .limitToLast(parseInt(limit));
    
    const snapshot = await query.once('value');
    
    const announcements = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const announcement = {
          id: child.key,
          ...child.val()
        };
        
        // Filter by type if specified
        if (!type || announcement.type === type) {
          announcements.unshift(announcement);
        }
      });
    }
    
    res.json({
      success: true,
      data: announcements,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/announcements",
  authenticateFirebaseToken,
  requirePermission(5),
  asyncHandler(async (req, res) => {
    const { title, description, type = 'general' } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: "Title and description are required"
      });
    }
    
    const announcementData = {
      title,
      description,
      type,
      fromUserUuid: userId,
      timestamp: Math.floor(Date.now() / 1000),
      createdAt: new Date().toISOString()
    };
    
    const announcementRef = await db.ref('community/announcements').push(announcementData);
    
    res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: {
        announcementId: announcementRef.key
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/community/events:
 *   get:
 *     summary: Get community events
 *     description: Retrieve a list of community events with optional filtering
 *     tags: [Community]
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
 *         description: Maximum number of events to return
 *       - in: query
 *         name: upcoming
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Filter to only show upcoming events
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [training, social, meeting, celebration, workshop]
 *         description: Filter events by type
 *     responses:
 *       200:
 *         description: Events retrieved successfully
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
 *                         $ref: '#/components/schemas/Event'
 *       401:
 *         description: Authentication required
 *   post:
 *     summary: Create a new event
 *     description: Create a new community event (requires level 4+ permission)
 *     tags: [Community]
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
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *               bannerUrl:
 *                 type: string
 *                 format: uri
 *               timestamp:
 *                 type: integer
 *                 description: Unix timestamp for event date/time
 *               location:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *               type:
 *                 type: string
 *                 enum: [training, social, meeting, celebration, workshop]
 *                 default: social
 *               coHosts:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of co-host user UUIDs
 *             required:
 *               - title
 *               - description
 *               - timestamp
 *               - location
 *     responses:
 *       201:
 *         description: Event created successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.get("/events", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const { limit = 10, upcoming = 'false', type } = req.query;
    
    let query = db.ref('community/events');
    
    if (upcoming === 'true') {
      const now = Math.floor(Date.now() / 1000);
      query = query.orderByChild('timestamp').startAt(now);
    } else {
      query = query.orderByChild('timestamp');
    }
    
    const snapshot = await query.limitToLast(parseInt(limit)).once('value');
    
    const events = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const event = {
          id: child.key,
          ...child.val()
        };
        
        // Filter by type if specified
        if (!type || event.type === type) {
          events.unshift(event);
        }
      });
    }
    
    res.json({
      success: true,
      data: events,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/events",
  authenticateFirebaseToken,
  requirePermission(4),
  asyncHandler(async (req, res) => {
    const { title, description, bannerUrl, timestamp, location, type = 'social', coHosts = [] } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!title || !description || !timestamp || !location) {
      return res.status(400).json({
        success: false,
        error: "Title, description, timestamp, and location are required"
      });
    }
    
    const eventData = {
      title,
      description,
      bannerUrl: bannerUrl || '',
      timestamp,
      location,
      type,
      hostUserUuid: userId,
      coHosts,
      createdAt: Math.floor(Date.now() / 1000)
    };
    
    const eventRef = await db.ref('community/events').push(eventData);
    
    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: {
        eventId: eventRef.key
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/community/gallery:
 *   get:
 *     summary: Get community gallery items
 *     description: Retrieve community gallery images and media
 *     tags: [Community]
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
 *         description: Maximum number of gallery items to return
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated list of tags to filter by
 *     responses:
 *       200:
 *         description: Gallery items retrieved successfully
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
 *                         $ref: '#/components/schemas/GalleryItem'
 *       401:
 *         description: Authentication required
 *   post:
 *     summary: Upload a new gallery item
 *     description: Upload a new image to the community gallery (requires level 3+ permission)
 *     tags: [Community]
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
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tags to categorize the gallery item
 *             required:
 *               - title
 *               - imageUrl
 *     responses:
 *       201:
 *         description: Gallery item uploaded successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.get("/gallery", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.MEDIUM),
  asyncHandler(async (req, res) => {
    const { limit = 10, tags } = req.query;
    
    const snapshot = await db.ref('community/gallery')
      .orderByChild('timestamp')
      .limitToLast(parseInt(limit))
      .once('value');
    
    const gallery = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const item = {
          id: child.key,
          ...child.val()
        };
        
        // Filter by tags if specified
        if (!tags || (item.tags && item.tags.some(tag => tags.split(',').includes(tag)))) {
          gallery.unshift(item);
        }
      });
    }
    
    res.json({
      success: true,
      data: gallery,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/gallery",
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { title, imageUrl, tags = [] } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!title || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: "Title and imageUrl are required"
      });
    }
    
    const galleryData = {
      title,
      imageUrl,
      tags,
      uploadedBy: userId,
      timestamp: Math.floor(Date.now() / 1000),
      createdAt: new Date().toISOString()
    };
    
    const galleryRef = await db.ref('community/gallery').push(galleryData);
    
    res.status(201).json({
      success: true,
      message: "Gallery item uploaded successfully",
      data: {
        galleryItemId: galleryRef.key
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/community/updates:
 *   get:
 *     summary: Get recent community updates
 *     description: Retrieve recent community updates like promotions, new members, etc.
 *     tags: [Community]
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
 *         description: Maximum number of updates to return
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [promotion, new_member, transfer, achievement, departure]
 *         description: Filter updates by type
 *     responses:
 *       200:
 *         description: Updates retrieved successfully
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
 *                         $ref: '#/components/schemas/CommunityUpdate'
 *       401:
 *         description: Authentication required
 *   post:
 *     summary: Create a new community update
 *     description: Create a new community update (requires level 6+ permission)
 *     tags: [Community]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [promotion, new_member, transfer, achievement, departure]
 *               title:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 200
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *               userUuid:
 *                 type: string
 *                 description: UUID of the user this update is about
 *               metadata:
 *                 type: object
 *                 description: Additional metadata specific to update type
 *             required:
 *               - type
 *               - title
 *               - description
 *               - userUuid
 *     responses:
 *       201:
 *         description: Update created successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 */
router.get("/updates", 
  authenticateFirebaseToken,
  cacheMiddleware(CACHE_DURATIONS.SHORT),
  asyncHandler(async (req, res) => {
    const { limit = 10, type } = req.query;
    
    const snapshot = await db.ref('community/updates')
      .orderByChild('timestamp')
      .limitToLast(parseInt(limit))
      .once('value');
    
    const updates = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const update = {
          id: child.key,
          ...child.val()
        };
        
        // Filter by type if specified
        if (!type || update.type === type) {
          updates.unshift(update);
        }
      });
    }
    
    res.json({
      success: true,
      data: updates,
      timestamp: new Date().toISOString()
    });
  })
);

router.post("/updates",
  authenticateFirebaseToken,
  requirePermission(6),
  asyncHandler(async (req, res) => {
    const { type, title, description, userUuid, metadata = {} } = req.body;
    const createdBy = req.authenticatedUser.uid;
    
    if (!type || !title || !description || !userUuid) {
      return res.status(400).json({
        success: false,
        error: "Type, title, description, and userUuid are required"
      });
    }
    
    const updateData = {
      type,
      title,
      description,
      userUuid,
      metadata,
      createdBy,
      timestamp: Math.floor(Date.now() / 1000),
      createdAt: new Date().toISOString()
    };
    
    const updateRef = await db.ref('community/updates').push(updateData);
    
    res.status(201).json({
      success: true,
      message: "Community update created successfully",
      data: {
        updateId: updateRef.key
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/community/announcements/{announcementId}:
 *   delete:
 *     summary: Delete an announcement
 *     description: Delete a community announcement (requires level 7+ permission or being the creator)
 *     tags: [Community]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: announcementId
 *         required: true
 *         schema:
 *           type: string
 *         description: Announcement ID
 *     responses:
 *       200:
 *         description: Announcement deleted successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Announcement not found
 */
router.delete("/announcements/:announcementId",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { announcementId } = req.params;
    const userId = req.authenticatedUser.uid;
    const userPermissionLevel = req.userData?.permissions?.level || 0;
    
    // Check if announcement exists and get creator info
    const announcementSnapshot = await db.ref(`community/announcements/${announcementId}`).once('value');
    
    if (!announcementSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Announcement not found"
      });
    }
    
    const announcement = announcementSnapshot.val();
    
    // Check permissions: level 7+ or creator can delete
    if (userPermissionLevel < 7 && announcement.fromUserUuid !== userId) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to delete this announcement"
      });
    }
    
    await db.ref(`community/announcements/${announcementId}`).remove();
    
    res.json({
      success: true,
      message: "Announcement deleted successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/community/events/{eventId}:
 *   delete:
 *     summary: Delete an event
 *     description: Delete a community event (requires level 6+ permission or being the host)
 *     tags: [Community]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *         description: Event ID
 *     responses:
 *       200:
 *         description: Event deleted successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Event not found
 */
router.delete("/events/:eventId",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const userId = req.authenticatedUser.uid;
    const userPermissionLevel = req.userData?.permissions?.level || 0;
    
    // Check if event exists and get host info
    const eventSnapshot = await db.ref(`community/events/${eventId}`).once('value');
    
    if (!eventSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Event not found"
      });
    }
    
    const event = eventSnapshot.val();
    
    // Check permissions: level 6+ or host can delete
    if (userPermissionLevel < 6 && event.hostUserUuid !== userId) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to delete this event"
      });
    }
    
    await db.ref(`community/events/${eventId}`).remove();
    
    res.json({
      success: true,
      message: "Event deleted successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
