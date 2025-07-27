/**
 * @swagger
 * tags:
 *   name: Onboarding
 *   description: User onboarding process
 */

import { Router } from "express";
import axios from "axios";
import admin from "../config/firebase.js";
import { authenticateFirebaseToken } from "../middleware/auth.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { ONBOARDING_VIEWS } from "../utils/constants.js";

const MAIN_GROUP_ID = "5692925";
const GROUPS_API = (id) => `https://groups.roblox.com/v2/users/${id}/groups/roles`;
const router = Router();
const firebaseService = new FirebaseService();

// Department hierarchy from high to low priority
const DEPARTMENT_HIERARCHY = [
  "corporate", // Corporate (group)
  "moderation", // Moderation (department)
  "public-relations", // Public Relations (department)
  "talent-acquisition", // Talent Acquisition (department)
  "hr", // HR (group)
  "mr", // MR (group)
  "lr", // LR (group)
];

/**
 * @swagger
 * /api/onboarding/status:
 *   get:
 *     summary: Get user's onboarding status
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding status retrieved successfully
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
 *                         completed:
 *                           type: boolean
 *                         currentStep:
 *                           type: integer
 *                         totalSteps:
 *                           type: integer
 *                         requiredFields:
 *                           type: object
 */

router.get(
  "/status",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userData = req.userData;

    const onboardingStatus = {
      completed: userData?.onboarding?.completed || false,
      currentStep: userData?.onboarding?.currentStep || 1,
      totalSteps: 4,
      requiredFields: {
        dateOfBirth: !!userData?.personal?.dateOfBirth,
        timezone: !!userData?.personal?.timezone,
        bio: !!userData?.profile?.bio,
        themeColor: !!userData?.profile?.themeColor,
        enabledViews: userData?.onboarding?.enabledViews?.length > 0,
        primaryDepartment: !!userData?.onboarding?.primaryDepartment,
      },
      availableViews: ONBOARDING_VIEWS,
    };

    res.json({
      success: true,
      data: onboardingStatus,
      timestamp: new Date().toISOString(),
    });
  })
);

router.get("/user-data", authenticateFirebaseToken, asyncHandler(async (req, res) => {
  const userData = req.userData;
  res.json({
    success: true,
    personal: userData.personal || {},
    profile: userData.profile || {},
    onboarding: userData.onboarding || {},
  });
}));

/**
 * @swagger
 * /api/onboarding/set-primary-department:
 *   post:
 *     summary: Set user's primary department
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - departmentId
 *             properties:
 *               departmentId:
 *                 type: string
 *                 description: The ID of the department to set as primary
 *     responses:
 *       200:
 *         description: Primary department updated successfully
 *       400:
 *         description: Invalid department ID or user not eligible
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/set-primary-department",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { departmentId } = req.body;

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        error: "Department ID is required",
      });
    }

    try {
      // Get user's current eligibility to validate the department selection
      const resp = await axios.get(GROUPS_API(userId), { timeout: 5000 });
      const memberships = resp.data.data || [];
      const groupRoleMap = {};
      memberships.forEach((g) => {
        groupRoleMap[g.group.id] = {
          name: g.role.name,
          rank: g.role.rank
        };
      });

      const mainGroupInfo = groupRoleMap[MAIN_GROUP_ID];
      const isMainGroupMember = !!mainGroupInfo;

      if (!isMainGroupMember) {
        return res.status(400).json({
          success: false,
          error: "User must be a member of the main group",
        });
      }

      // Check if the department exists and user is eligible
      const deptSnap = await admin.database().ref(`/departments/${departmentId}`).once("value");
      const department = deptSnap.val();

      if (!department || !department.isActive) {
        return res.status(400).json({
          success: false,
          error: "Invalid or inactive department",
        });
      }

      // Check user eligibility for this department
      const groupInfo = groupRoleMap[department.groupId];
      const userRank = groupInfo ? groupInfo.rank : null;
      const requiredRank = typeof department.settings?.requiredRole === "number" ? department.settings.requiredRole : 0;

      const members = (department.members && typeof department.members === "object") ? Object.keys(department.members) : [];
      const isAlreadyMember = members.includes(userId);

      let eligible = false;
      if (isAlreadyMember) {
        eligible = true;
      } else if (isMainGroupMember && groupInfo && userRank >= requiredRank) {
        eligible = true;
      }

      if (!eligible) {
        return res.status(400).json({
          success: false,
          error: "User is not eligible for this department",
        });
      }

      // Update user's primary department
      const updates = {
        "onboarding/primaryDepartment": departmentId,
      };

      await firebaseService.updateUser(userId, updates);

      res.json({
        success: true,
        message: "Primary department updated successfully",
        data: { primaryDepartment: departmentId },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error setting primary department:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to set primary department",
      });
    }
  })
);

/**
 * @swagger
 * /api/onboarding/personal-info:
 *   post:
 *     summary: Submit personal information (step 1)
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dateOfBirth
 *               - timezone
 *             properties:
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               timezone:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Personal information updated successfully
 */

router.post(
  "/personal-info",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { dateOfBirth, timezone, firstName, lastName, email } = req.body;

    if (!dateOfBirth || !timezone) {
      return res.status(400).json({
        success: false,
        error: "Date of birth and timezone are required",
      });
    }

    const updates = {
      "personal/dateOfBirth": dateOfBirth,
      "personal/email": email,
      "personal/timezone": timezone,
      "personal/firstName": firstName || null,
      "personal/lastName": lastName || null,
      "onboarding/currentStep": 2,
    };

    await firebaseService.updateUser(userId, updates);

    res.json({
      success: true,
      message: "Personal information updated",
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/onboarding/profile-setup:
 *   post:
 *     summary: Set up profile (step 2)
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bio:
 *                 type: string
 *               themeColor:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile setup completed successfully
 */

router.post(
  "/profile-setup",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { bio, themeColor } = req.body;

    const updates = {
      "profile/bio": bio || "",
      "profile/themeColor": themeColor || "#3498db",
      "onboarding/currentStep": 3,
    };

    await firebaseService.updateUser(userId, updates);

    res.json({
      success: true,
      message: "Profile setup completed",
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/onboarding/views-selection:
 *   post:
 *     summary: Select views (step 3)
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabledViews
 *             properties:
 *               enabledViews:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Views selection completed successfully
 */

router.post(
  "/views-selection",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { enabledViews } = req.body;

    if (!Array.isArray(enabledViews)) {
      return res.status(400).json({
        success: false,
        error: "enabledViews must be an array",
      });
    }

    const validViews = enabledViews.filter((view) => ONBOARDING_VIEWS.includes(view));

    const updates = {
      "onboarding/enabledViews": validViews,
      "onboarding/currentStep": 4,
    };

    await firebaseService.updateUser(userId, updates);

    res.json({
      success: true,
      message: "Views selection completed",
      data: { enabledViews: validViews },
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/onboarding/complete:
 *   post:
 *     summary: Complete onboarding process (step 4)
 *     tags: [Onboarding]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding completed successfully
 *       400:
 *         description: Cannot complete onboarding, missing required steps
 */

router.post(
  "/complete",
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const userData = req.userData;

    const requiredFields = [
      userData?.personal?.dateOfBirth, 
      userData?.personal?.timezone, 
      userData?.profile?.themeColor, 
      userData?.onboarding?.enabledViews?.length > 0,
      userData?.onboarding?.primaryDepartment
    ];

    if (requiredFields.some((field) => !field)) {
      return res.status(400).json({
        success: false,
        error: "Please complete all onboarding steps first, including selecting a primary department",
      });
    }

    // Update custom user data
    const updates = {
      "onboarding/completed": true,
      "onboarding/completedAt": Date.now(),
      "activity/isActive": true,
    };

    await firebaseService.updateUser(userId, updates);

    // Update Firebase Auth user emailVerified property
    await admin.auth().updateUser(userId, {
      emailVerified: true
    });

    res.json({
      success: true,
      message: "Onboarding completed successfully",
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/onboarding/eligible:
 *   get:
 *     summary: Check user's Roblox group memberships and department eligibility
 *     description: >
 *       Verifies if the user is in the main group, department-specific groups, and partner groups.
 *       Checks if the user is listed as a representative in Firebase and if they are a member of the respective Roblox groups.
 *       Also retrieves the user's role in each group and determines auto-assignments based on department settings.
 *     tags:
 *       - Onboarding
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User's group memberships and department eligibility
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     mainGroup:
 *                       type: object
 *                       properties:
 *                         groupMember:
 *                           type: boolean
 *                         role:
 *                           type: string
 *                     departments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           eligible:
 *                             type: boolean
 *                           role:
 *                             type: string
 *                     partners:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           groupMember:
 *                             type: boolean
 *                           role:
 *                             type: string
 *                     autoAddDepartments:
 *                       type: array
 *                       items:
 *                         type: string
 *                     primaryDepartment:
 *                       type: string
 *                       nullable: true
 *       401:
 *         description: Unauthorized (invalid or missing token)
 *       500:
 *         description: Internal server error
 */

// Helper to get Roblox group icon
async function getRobloxGroupIcon(groupId) {
  try {
    const resp = await axios.get(
      `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupId}&size=150x150&format=Png&isCircular=true`
    );
    if (
      resp.data &&
      resp.data.data &&
      resp.data.data[0] &&
      resp.data.data[0].imageUrl
    ) {
      return resp.data.data[0].imageUrl;
    }
    return null;
  } catch {
    return null;
  }
}

// Helper to get Roblox group name
async function getRobloxGroupName(groupId) {
  try {
    const resp = await axios.get(
      `https://groups.roblox.com/v1/groups/${groupId}`
    );
    if (resp.data && resp.data.name) {
      return resp.data.name;
    }
    return null;
  } catch {
    return null;
  }
}

// Helper to determine the highest priority department for auto-selection
function getHighestPriorityDepartment(eligibleDepartments) {
  if (!eligibleDepartments || eligibleDepartments.length === 0) return null;
  
  // Sort by hierarchy priority (lower index = higher priority)
  const sortedByPriority = eligibleDepartments
    .filter(dept => dept.eligible)
    .sort((a, b) => {
      const aIndex = DEPARTMENT_HIERARCHY.indexOf(a.id);
      const bIndex = DEPARTMENT_HIERARCHY.indexOf(b.id);
      
      // If department not in hierarchy, put it at the end
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      
      return aIndex - bIndex;
    });
  
  return sortedByPriority.length > 0 ? sortedByPriority[0].id : null;
}

router.get("/eligible", authenticateFirebaseToken, asyncHandler(async (req, res) => {
  const uid = req.authenticatedUser.uid;
  const userData = req.userData;

  try {
    const resp = await axios.get(GROUPS_API(uid), { timeout: 5000 });
    const memberships = resp.data.data || [];
    
    // Map: groupId -> { name, rank }
    const groupRoleMap = {};
    memberships.forEach((g) => {
      groupRoleMap[g.group.id] = {
        name: g.role.name,
        rank: g.role.rank
      };
    });

    const mainGroupInfo = groupRoleMap[MAIN_GROUP_ID];
    const isMainGroupMember = !!mainGroupInfo;
    const mainGroupRole = mainGroupInfo ? mainGroupInfo.name : null;

    // Update user's profile role in Firebase Realtime Database
    await admin.database().ref(`/users/${uid}/profile/role`).set(mainGroupRole);

    const [deptSnap, partnerSnap] = await Promise.all([
      admin.database().ref("/departments").once("value"),
      admin.database().ref("/partners/organizations").once("value"),
    ]);
    const departments = deptSnap.val() || {};
    const partners = partnerSnap.val() || {};

    const deptResults = [];
    const autoAdd = [];

    // For each department, check eligibility and auto-add to members if needed
    await Promise.all(
      Object.entries(departments).map(async ([id, dept]) => {
        if (!dept.isActive) return;

        const groupInfo = groupRoleMap[dept.groupId];
        const userRank = groupInfo ? groupInfo.rank : null;
        const userRoleName = groupInfo ? groupInfo.name : null;
        const requiredRank = typeof dept.settings?.requiredRole === "number" ? dept.settings.requiredRole : 0;

        const members = (dept.members && typeof dept.members === "object") ? Object.keys(dept.members) : [];
        const isAlreadyMember = members.includes(uid);

        let eligible = false;
        let status = "ineligible";

        if (isAlreadyMember) {
          eligible = true;
          status = "active";
        } else if (isMainGroupMember && groupInfo && userRank >= requiredRank) {
          if (dept.settings?.autoApprove) {
            eligible = true;
            status = "active";
            // Add to members if not already
            if (!isAlreadyMember) {
              await admin
                .database()
                .ref(`/departments/${id}/members/${uid}`)
                .set({
                  joinedAt: Date.now(),
                  role: userRoleName,
                  rank: userRank,
                });
            }
            autoAdd.push(id);
          } else {
            eligible = true;
            status = "pending";
          }
        }

        deptResults.push({
          id,
          name: dept.name || "",
          role: userRoleName,
          rank: userRank,
          eligible,
          status,
        });
      })
    );

    // Partner results with group icon and name
    const partnerResults = await Promise.all(
      Object.entries(partners).map(async ([id, p]) => {
        const isRepresentative =
          Array.isArray(p.representatives) &&
          p.representatives.some((rep) => rep.robloxId === uid);

        const isInGroup = !!groupRoleMap[p.groupId];

        // Fetch group icon and name in parallel
        const [groupIcon, groupName] = p.groupId
          ? await Promise.all([
              getRobloxGroupIcon(p.groupId),
              getRobloxGroupName(p.groupId),
            ])
          : [null, null];

        return {
          id,
          name: p.name,
          groupName: groupName || "",
          representative: isRepresentative,
          groupId: p.groupId,
          groupIcon,
          groupMember: isInGroup,
          role: isRepresentative
            ? p.representatives.find((rep) => rep.robloxId === uid).role
            : isInGroup
            ? groupRoleMap[p.groupId]?.name
            : null,
        };
      })
    );

    // Auto-select primary department if not already set
    let primaryDepartment = userData?.onboarding?.primaryDepartment;
    if (!primaryDepartment && deptResults.length > 0) {
      const autoSelectedPrimary = getHighestPriorityDepartment(deptResults);
      if (autoSelectedPrimary) {
        primaryDepartment = autoSelectedPrimary;
        // Update in Firebase
        await firebaseService.updateUser(uid, {
          "onboarding/primaryDepartment": autoSelectedPrimary,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        mainGroup: { groupMember: isMainGroupMember, role: mainGroupRole },
        departments: deptResults,
        autoAddDepartments: autoAdd,
        partners: partnerResults,
        primaryDepartment: primaryDepartment || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in /eligible endpoint:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch eligibility data",
      timestamp: new Date().toISOString(),
    });
  }
}));

export default router;
