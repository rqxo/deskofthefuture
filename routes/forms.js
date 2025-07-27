/**
 * @swagger
 * tags:
 *   name: Forms
 *   description: Application and form management system
 */

import { Router } from "express";
import { authenticateFirebaseToken, requirePermission } from "../middleware/auth.js";
import { FirebaseService } from "../services/firebaseService.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();
const firebaseService = new FirebaseService();

/**
 * @swagger
 * /api/forms:
 *   get:
 *     summary: Get available forms for user
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Available forms retrieved successfully
 */

router.get("/", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const userLevel = req.userData.permissions.level;
    const forms = await firebaseService.getAvailableForms(userId, userLevel);
    
    res.json({
      success: true,
      data: forms,
      count: Object.keys(forms).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/{formId}:
 *   get:
 *     summary: Get specific form
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *         description: Form ID
 *     responses:
 *       200:
 *         description: Form retrieved successfully
 *       404:
 *         description: Form not found
 */


router.get("/:formId", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { formId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const form = await firebaseService.getForm(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: "Form not found"
      });
    }
    
    const eligibility = await firebaseService.checkFormEligibility(formId, userId);
    
    const sanitizedForm = {
      id: form.id,
      title: form.title,
      description: form.description,
      department: form.department,
      fields: form.fields.map(field => ({
        id: field.id,
        type: field.type,
        label: field.label,
        required: field.required,
        options: field.options,
        validation: field.validation ? {
          minLength: field.validation.minLength,
          maxLength: field.validation.maxLength
        } : undefined,
        questions: field.questions ? field.questions.map(q => ({
          question: q.question,
          options: q.options
        })) : undefined
      })),
      estimatedTime: firebaseService.calculateFormTime(form.fields)
    };
    
    res.json({
      success: true,
      data: {
        form: sanitizedForm,
        eligible: eligibility.eligible,
        reason: eligibility.reason
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/{formId}/submit:
 *   post:
 *     summary: Submit form application
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
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
 *               - responses
 *             properties:
 *               responses:
 *                 type: object
 *     responses:
 *       201:
 *         description: Form submitted successfully
 */


router.post("/:formId/submit", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { formId } = req.params;
    const { responses } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Responses object is required"
      });
    }
    
    const form = await firebaseService.getForm(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: "Form not found"
      });
    }
    
    const eligibility = await firebaseService.checkFormEligibility(formId, userId);
    if (!eligibility.eligible) {
      return res.status(403).json({
        success: false,
        error: eligibility.reason
      });
    }
    
    const requiredFields = form.fields.filter(field => field.required);
    const missingFields = requiredFields.filter(field => !responses[field.id]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.map(f => f.label).join(', ')}`
      });
    }
    
    for (const field of form.fields) {
      const response = responses[field.id];
      if (!response) continue;
      
      if (field.type === 'text' && field.validation) {
        if (field.validation.minLength && response.length < field.validation.minLength) {
          return res.status(400).json({
            success: false,
            error: `${field.label} must be at least ${field.validation.minLength} characters long`
          });
        }
        if (field.validation.maxLength && response.length > field.validation.maxLength) {
          return res.status(400).json({
            success: false,
            error: `${field.label} must be no more than ${field.validation.maxLength} characters long`
          });
        }
      }
      
      if (field.type === 'quiz' && field.questions) {
        if (!response.answers || !Array.isArray(response.answers)) {
          return res.status(400).json({
            success: false,
            error: `${field.label} requires quiz answers`
          });
        }
        if (response.answers.length !== field.questions.length) {
          return res.status(400).json({
            success: false,
            error: `${field.label} requires answers to all questions`
          });
        }
      }
    }
    
    const submission = await firebaseService.submitForm(formId, userId, responses);
    
    res.status(201).json({
      success: true,
      data: {
        submissionId: submission.id,
        status: submission.status,
        score: submission.evaluation?.automated?.overallScore,
        feedback: submission.status === 'approved' ? 'Congratulations! Your application has been approved.' :
                 submission.status === 'rejected' ? 'Your application was not successful this time. Please try again later.' :
                 'Your application is under review. You will be notified of the decision soon.'
      },
      message: "Form submitted successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/submissions/my:
 *   get:
 *     summary: Get user's form submissions
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Submissions retrieved successfully
 */

router.get("/submissions/my", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const userId = req.authenticatedUser.uid;
    const { status, limit = 20, offset = 0 } = req.query;
    
    let submissions = await firebaseService.getUserSubmissions(userId);
    
    if (status) {
      const filteredSubmissions = {};
      Object.entries(submissions).forEach(([id, submission]) => {
        if (submission.status === status) {
          filteredSubmissions[id] = submission;
        }
      });
      submissions = filteredSubmissions;
    }
    
    const submissionsList = Object.entries(submissions)
      .sort(([_, a], [__, b]) => b.submittedAt - a.submittedAt)
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
      .map(([id, submission]) => ({
        id,
        formId: submission.formId,
        formTitle: submission.formTitle,
        formDepartment: submission.formDepartment,
        status: submission.status,
        score: submission.evaluation?.automated?.overallScore,
        submittedAt: submission.submittedAt
      }));
    
    res.json({
      success: true,
      data: submissionsList,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: Object.keys(submissions).length
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/department/{departmentId}:
 *   get:
 *     summary: Get forms for specific department (requires level 3+ permission)
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: departmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Department forms retrieved successfully
 *       403:
 *         description: Insufficient permissions
 */


router.get("/department/:departmentId", 
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const userDepartment = req.userData.permissions.department;
    const userLevel = req.userData.permissions.level;
    
    if (userDepartment !== departmentId && userLevel < 8) {
      return res.status(403).json({
        success: false,
        error: "You can only access forms for your department"
      });
    }
    
    const snapshot = await firebaseService.db.ref('/forms/templates')
      .orderByChild('department')
      .equalTo(departmentId)
      .once('value');
    
    const forms = snapshot.val() || {};
    
    res.json({
      success: true,
      data: forms,
      count: Object.keys(forms).length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/create:
 *   post:
 *     summary: Create new form (requires level 7+ permission)
 *     tags: [Forms]
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
 *               - fields
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               fields:
 *                 type: array
 *                 items:
 *                   type: object
 *               requirements:
 *                 type: object
 *     responses:
 *       201:
 *         description: Form created successfully
 */


router.post("/create", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { title, description, fields, requirements } = req.body;
    const createdBy = req.authenticatedUser.uid;
    const department = req.userData.permissions.department;
    
    if (!title || !description || !fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Title, description, and at least one field are required"
      });
    }
    
    const formRef = firebaseService.db.ref('/forms/templates').push();
    
    const formData = {
      id: formRef.key,
      title,
      description,
      department,
      createdBy,
      status: 'draft',
      requirements: requirements || {
        minLevel: 1,
        minDaysActive: 0
      },
      fields: fields.map((field, index) => ({
        ...field,
        id: `field_${index + 1}`
      })),
      autoEvaluation: {
        enabled: true,
        criteria: {
          grammarWeight: 0.3,
          lengthWeight: 0.2,
          quizWeight: 0.5
        },
        thresholds: {
          autoApprove: 85,
          autoReject: 40,
          manualReview: 60
        }
      },
      analytics: {
        totalSubmissions: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        averageScore: 0
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await formRef.set(formData);
    
    res.status(201).json({
      success: true,
      data: { formId: formRef.key },
      message: "Form created successfully",
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/{formId}/status:
 *   put:
 *     summary: Update form status (requires level 7+ permission)
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, active, inactive, archived]
 *     responses:
 *       200:
 *         description: Form status updated successfully
 */

router.put("/:formId/status", 
  authenticateFirebaseToken,
  requirePermission(7),
  asyncHandler(async (req, res) => {
    const { formId } = req.params;
    const { status } = req.body;
    const userId = req.authenticatedUser.uid;
    
    if (!['draft', 'active', 'inactive', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: draft, active, inactive, archived"
      });
    }
    
    const form = await firebaseService.getForm(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: "Form not found"
      });
    }
    
    if (form.department !== req.userData.permissions.department && req.userData.permissions.level < 8) {
      return res.status(403).json({
        success: false,
        error: "You can only update forms for your department"
      });
    }
    
    await firebaseService.db.ref(`/forms/templates/${formId}`).update({
      status,
      updatedAt: Date.now(),
      updatedBy: userId
    });
    
    res.json({
      success: true,
      message: `Form status updated to ${status}`,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/submissions/{submissionId}:
 *   get:
 *     summary: Get specific submission
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Submission retrieved successfully
 *       404:
 *         description: Submission not found
 */

router.get("/submissions/:submissionId", 
  authenticateFirebaseToken,
  asyncHandler(async (req, res) => {
    const { submissionId } = req.params;
    const userId = req.authenticatedUser.uid;
    
    const snapshot = await firebaseService.db.ref(`/forms/submissions/${submissionId}`).once('value');
    const submission = snapshot.val();
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        error: "Submission not found"
      });
    }
    
    const isOwner = submission.userId === userId;
    const isDepartmentMember = submission.formDepartment === req.userData.permissions.department;
    const isAdmin = req.userData.permissions.level >= 7;
    
    if (!isOwner && !isDepartmentMember && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to view this submission"
      });
    }
    
    res.json({
      success: true,
      data: submission,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * @swagger
 * /api/forms/submissions/{submissionId}/review:
 *   put:
 *     summary: Review form submission (requires level 3+ permission)
 *     tags: [Forms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
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
 *               - decision
 *               - feedback
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [approved, rejected]
 *               feedback:
 *                 type: string
 *               score:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Submission reviewed successfully
 */

router.put("/submissions/:submissionId/review", 
  authenticateFirebaseToken,
  requirePermission(3),
  asyncHandler(async (req, res) => {
    const { submissionId } = req.params;
    const { decision, feedback, score } = req.body;
    const reviewerId = req.authenticatedUser.uid;
    
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: "Decision must be either 'approved' or 'rejected'"
      });
    }
    
    if (!feedback || feedback.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: "Feedback must be at least 10 characters long"
      });
    }
    
    if (score !== undefined && (score < 0 || score > 100)) {
      return res.status(400).json({
        success: false,
        error: "Score must be between 0 and 100"
      });
    }
    
    const snapshot = await firebaseService.db.ref(`/forms/submissions/${submissionId}`).once('value');
    const submission = snapshot.val();
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        error: "Submission not found"
      });
    }
    
    if (submission.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: "Only pending submissions can be reviewed"
      });
    }
    
    const formSnapshot = await firebaseService.db.ref(`/forms/templates/${submission.formId}`).once('value');
    const form = formSnapshot.val();
    
    if (form.department !== req.userData.permissions.department && req.userData.permissions.level < 7) {
      return res.status(403).json({
        success: false,
        error: "You can only review submissions for your department"
      });
    }
    
    const updates = {
      status: decision,
      "evaluation/manual": {
        reviewedBy: reviewerId,
        reviewedAt: Date.now(),
        score: score || submission.evaluation.automated.overallScore,
        feedback: feedback.trim(),
        decision: decision
      },
      updatedAt: Date.now()
    };
    
    await firebaseService.db.ref(`/forms/submissions/${submissionId}`).update(updates);
    
    await firebaseService.db.ref(`/forms/templates/${submission.formId}/analytics/${decision}`).transaction(count => (count || 0) + 1);
    await firebaseService.db.ref(`/forms/templates/${submission.formId}/analytics/pending`).transaction(count => Math.max(0, (count || 0) - 1));
    
    res.json({
      success: true,
      message: `Submission ${decision}`,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
