import { Router } from "express";
import admin from "../config/firebase.js";
import { authenticateFirebaseToken } from "../middleware/auth.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();
const firebaseService = new FirebaseService();

// Get user's notifications
router.get(
  "/",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { limit = 50, offset = 0 } = req.query;

    const notificationsRef = admin.database().ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.orderByChild("timestamp").limitToLast(parseInt(limit)).once("value");
    
    const notifications = [];
    if (snapshot.exists()) {
      const data = snapshot.val();
      Object.keys(data).forEach(key => {
        notifications.push({
          id: key,
          ...data[key]
        });
      });
    }

    // Sort by timestamp (newest first)
    notifications.sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      data: {
        notifications: notifications.slice(offset, offset + parseInt(limit)),
        total: notifications.length,
        unreadCount: notifications.filter(n => !n.read).length
      },
      timestamp: new Date().toISOString(),
    });
  })
);

// Send notification to a user
router.post(
  "/send",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const fromUserId = req.authenticatedUser.uid;
    const { toUserId, title, description, type = "general" } = req.body;

    if (!toUserId || !title || !description) {
      return res.status(400).json({
        success: false,
        error: "toUserId, title, and description are required",
      });
    }

    // Verify the target user exists
    try {
      await admin.auth().getUser(toUserId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: "Target user not found",
      });
    }

    const notificationId = admin.database().ref().push().key;
    const notification = {
      title,
      description,
      type,
      timestamp: Math.floor(Date.now() / 1000),
      fromUserUuid: fromUserId,
      read: false,
      createdAt: Date.now()
    };

    await admin.database().ref(`users/${toUserId}/notifications/${notificationId}`).set(notification);

    res.json({
      success: true,
      message: "Notification sent successfully",
      data: {
        notificationId,
        ...notification
      },
      timestamp: new Date().toISOString(),
    });
  })
);

// Send notification to multiple users
router.post(
  "/send-bulk",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const fromUserId = req.authenticatedUser.uid;
    const { userIds, title, description, type = "general" } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0 || !title || !description) {
      return res.status(400).json({
        success: false,
        error: "userIds (array), title, and description are required",
      });
    }

    if (userIds.length > 100) {
      return res.status(400).json({
        success: false,
        error: "Cannot send to more than 100 users at once",
      });
    }

    const notification = {
      title,
      description,
      type,
      timestamp: Math.floor(Date.now() / 1000),
      fromUserUuid: fromUserId,
      read: false,
      createdAt: Date.now()
    };

    const updates = {};
    const results = [];

    for (const userId of userIds) {
      try {
        // Verify user exists
        await admin.auth().getUser(userId);
        const notificationId = admin.database().ref().push().key;
        updates[`users/${userId}/notifications/${notificationId}`] = notification;
        results.push({ userId, notificationId, success: true });
      } catch (error) {
        results.push({ userId, success: false, error: "User not found" });
      }
    }

    await admin.database().ref().update(updates);

    res.json({
      success: true,
      message: `Notifications sent to ${results.filter(r => r.success).length} users`,
      data: {
        results,
        totalSent: results.filter(r => r.success).length,
        totalFailed: results.filter(r => !r.success).length
      },
      timestamp: new Date().toISOString(),
    });
  })
);

// Send notification to department members
router.post(
  "/send-department",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const fromUserId = req.authenticatedUser.uid;
    const { departmentId, title, description, type = "department" } = req.body;

    if (!departmentId || !title || !description) {
      return res.status(400).json({
        success: false,
        error: "departmentId, title, and description are required",
      });
    }

    // Get department members
    const deptSnapshot = await admin.database().ref(`departments/${departmentId}/members`).once("value");
    
    if (!deptSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Department not found or has no members",
      });
    }

    const members = Object.keys(deptSnapshot.val());
    const notification = {
      title,
      description,
      type,
      timestamp: Math.floor(Date.now() / 1000),
      fromUserUuid: fromUserId,
      read: false,
      createdAt: Date.now(),
      departmentId
    };

    const updates = {};
    for (const memberId of members) {
      const notificationId = admin.database().ref().push().key;
      updates[`users/${memberId}/notifications/${notificationId}`] = notification;
    }

    await admin.database().ref().update(updates);

    res.json({
      success: true,
      message: `Notification sent to ${members.length} department members`,
      data: {
        departmentId,
        memberCount: members.length,
        ...notification
      },
      timestamp: new Date().toISOString(),
    });
  })
);

// Mark notification as read
router.patch(
  "/:notificationId/read",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { notificationId } = req.params;

    const notificationRef = admin.database().ref(`users/${userId}/notifications/${notificationId}`);
    const snapshot = await notificationRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }

    await notificationRef.update({
      read: true,
      readAt: Date.now()
    });

    res.json({
      success: true,
      message: "Notification marked as read",
      timestamp: new Date().toISOString(),
    });
  })
);

// Mark all notifications as read
router.patch(
  "/read-all",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;

    const notificationsRef = admin.database().ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.once("value");

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        message: "No notifications to mark as read",
        timestamp: new Date().toISOString(),
      });
    }

    const updates = {};
    const notifications = snapshot.val();
    let updatedCount = 0;

    Object.keys(notifications).forEach(notificationId => {
      if (!notifications[notificationId].read) {
        updates[`users/${userId}/notifications/${notificationId}/read`] = true;
        updates[`users/${userId}/notifications/${notificationId}/readAt`] = Date.now();
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      await admin.database().ref().update(updates);
    }

    res.json({
      success: true,
      message: `${updatedCount} notifications marked as read`,
      data: { updatedCount },
      timestamp: new Date().toISOString(),
    });
  })
);

// Delete notification
router.delete(
  "/:notificationId",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { notificationId } = req.params;

    const notificationRef = admin.database().ref(`users/${userId}/notifications/${notificationId}`);
    const snapshot = await notificationRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }

    await notificationRef.remove();

    res.json({
      success: true,
      message: "Notification deleted successfully",
      timestamp: new Date().toISOString(),
    });
  })
);

// Get notification statistics
router.get(
  "/stats",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;

    const notificationsRef = admin.database().ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.once("value");

    let total = 0;
    let unread = 0;
    let byType = {};
    let recent = 0;

    if (snapshot.exists()) {
      const notifications = snapshot.val();
      const now = Math.floor(Date.now() / 1000);
      const oneDayAgo = now - (24 * 60 * 60);

      Object.values(notifications).forEach(notification => {
        total++;
        if (!notification.read) unread++;
        if (notification.timestamp > oneDayAgo) recent++;
        
        const type = notification.type || "general";
        byType[type] = (byType[type] || 0) + 1;
      });
    }

    res.json({
      success: true,
      data: {
        total,
        unread,
        read: total - unread,
        recent24h: recent,
        byType
      },
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
