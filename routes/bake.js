/**
 * @swagger
 * tags:
 *   name: BAKE
 *   description: Bristo's Administrative & Knowledge Environment
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
 * /api/bake/documents:
 *   get:
 *     summary: Get all documents
 *     tags: [BAKE]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by document category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in title, content, and tags
 *       - in: query
 *         name: public_only
 *         schema:
 *           type: string
 *           default: "true"
 *         description: Show only public documents
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 *   post:
 *     summary: Create new document (requires level 7+ permission)
 *     tags: [BAKE]
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
 *               - content
 *               - category
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               category:
 *                 type: string
 *               subcategory:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isPublic:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Document created successfully
 */


router.get("/documents", 
  cacheMiddleware(300),
  asyncHandler(async (req, res) => {
    const { category, search, public_only = "true" } = req.query;
    const publicOnly = public_only === "true";
    const documents = await firebaseService.getBakeDocuments(category, search, publicOnly);
    
    res.json({
      success: true,
      data: documents,
      count: Object.keys(documents).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/bake/documents/{documentId}:
 *   get:
 *     summary: Get specific document
 *     tags: [BAKE]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document retrieved successfully
 *       404:
 *         description: Document not found
 *   put:
 *     summary: Update document (requires level 7+ permission)
 *     tags: [BAKE]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               category:
 *                 type: string
 *               subcategory:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isPublic:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Document updated successfully
 */


router.get("/documents/:documentId", 
  cacheMiddleware(600),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const document = await firebaseService.getBakeDocument(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found"
      });
    }
    
    await firebaseService.incrementDocumentViews(documentId);
    
    res.json({
      success: true,
      data: document,
      timestamp: new Date().toISOString()
    });
  })
);



router.post("/documents", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { title, content, category, subcategory, tags, isPublic } = req.body;
    
    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        error: "Title, content, and category are required"
      });
    }
    
    const author = req.authenticatedUser.uid;
    const department = req.userData.permissions.department;
    
    const documentData = {
      title,
      content,
      category,
      subcategory: subcategory || null,
      tags: tags || [],
      isPublic: isPublic !== false,
      author,
      department,
      status: "draft"
    };
    
    const documentId = await firebaseService.createBakeDocument(documentData);
    
    res.status(201).json({
      success: true,
      data: { documentId },
      message: "Document created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

router.put("/documents/:documentId", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const updates = req.body;
    const userId = req.authenticatedUser.uid;
    
    const document = await firebaseService.getBakeDocument(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found"
      });
    }
    
    if (document.author !== userId && req.userData.permissions.level < 8) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to edit this document"
      });
    }
    
    const updateData = {
      ...updates,
      "metadata/updatedAt": Date.now(),
      "metadata/lastEditedBy": userId
    };
    
    await firebaseService.db.ref(`/bake/documents/${documentId}`).update(updateData);
    
    res.json({
      success: true,
      message: "Document updated successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/bake/documents/{documentId}/publish:
 *   post:
 *     summary: Publish document (requires level 7+ permission)
 *     tags: [BAKE]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document published successfully
 */


router.post("/documents/:documentId/publish", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const document = await firebaseService.getBakeDocument(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found"
      });
    }
    
    if (document.author !== userId && req.userData.permissions.level < 8) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to publish this document"
      });
    }
    
    const updateData = {
      status: "published",
      "metadata/publishedAt": Date.now(),
      "metadata/publishedBy": userId
    };
    
    await firebaseService.db.ref(`/bake/documents/${documentId}`).update(updateData);
    
    res.json({
      success: true,
      message: "Document published successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/bake/categories:
 *   get:
 *     summary: Get all document categories
 *     tags: [BAKE]
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 */


router.get("/categories", 
  cacheMiddleware(3600),
  asyncHandler(async (req, res) => {
    const snapshot = await firebaseService.db.ref('/bake/categories').once('value');
    const categories = snapshot.val() || {};
    
    res.json({
      success: true,
      data: categories,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/bake/maia/chat:
 *   post:
 *     summary: Chat with MAIA AI Assistant
 *     tags: [BAKE]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 500
 *               sessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: MAIA response generated successfully
 *       400:
 *         description: Invalid message format
 */

router.post("/maia/chat", 
  asyncHandler(async (req, res) => {
    const { message, sessionId } = req.body;
    const userId = req.authenticatedUser?.uid || "anonymous";
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message is required and cannot be empty"
      });
    }
    
    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Message is too long (max 500 characters)"
      });
    }
    
    const response = await firebaseService.processMAIAQuery(message.trim(), userId, sessionId);
    
    res.json({
      success: true,
      data: response,
      timestamp: new Date().toISOString()
    });
  })
);


/**
 * @swagger
 * /api/bake/maia/conversations/{sessionId}:
 *   get:
 *     summary: Get MAIA conversation history
 *     tags: [BAKE]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Conversation session ID
 *     responses:
 *       200:
 *         description: Conversation retrieved successfully
 *       404:
 *         description: Conversation not found
 */

router.get("/maia/conversations/:sessionId", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const snapshot = await firebaseService.db.ref(`/bake/maia/conversations/${sessionId}`).once('value');
    const conversation = snapshot.val();
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found"
      });
    }
    
    if (conversation.userId !== userId && req.userData.permissions.level < 5) {
      return res.status(403).json({
        success: false,
        error: "Access denied to this conversation"
      });
    }
    
    res.json({
      success: true,
      data: conversation,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/bake/documents/{documentId}/feedback:
 *   post:
 *     summary: Submit feedback for document
 *     tags: [BAKE]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - helpful
 *             properties:
 *               helpful:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Feedback recorded successfully
 */

router.post("/documents/:documentId/feedback", 
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const { helpful } = req.body;
    
    if (typeof helpful !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "Helpful field must be a boolean"
      });
    }
    
    const feedbackField = helpful ? 'helpful' : 'notHelpful';
    await firebaseService.db.ref(`/bake/documents/${documentId}/analytics/${feedbackField}`)
      .transaction(count => (count || 0) + 1);
    
    res.json({
      success: true,
      message: "Feedback recorded successfully",
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
