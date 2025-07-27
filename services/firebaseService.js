import admin from "../config/firebase.js";

export class FirebaseService {
  constructor() {
    this.db = admin.database();
  }

  async getUser(userId) {
    const snapshot = await this.db.ref(`/users/${userId}`).once('value');
    return snapshot.val();
  }

  async updateUser(userId, updates) {
    const updateData = {
      ...updates,
      "activity/updatedAt": Date.now()
    };
    
    await this.db.ref(`/users/${userId}`).update(updateData);
    return true;
  }

  async createUser(userId, userData) {
    const now = Date.now();
    const newUser = {
      ...userData,
      activity: {
        isActive: true,
        createdAt: now,
        updatedAt: now,
        lastSeen: now
      },
      onboarding: {
        completed: false,
        currentStep: 1,
        enabledViews: []
      },
      permissions: {
        level: 1,
        role: "base_rank",
        department: "general"
      }
    };
    
    await this.db.ref(`/users/${userId}`).set(newUser);
    return newUser;
  }

  async searchUsers(filters, limit = 20, offset = 0) {
    const snapshot = await this.db.ref('/users').once('value');
    let users = Object.entries(snapshot.val() || {});
    
    if (filters.username) {
      users = users.filter(([_, userData]) => 
        userData.profile?.username?.toLowerCase().includes(filters.username.toLowerCase())
      );
    }
    
    if (filters.department) {
      users = users.filter(([_, userData]) => 
        userData.permissions?.department === filters.department
      );
    }
    
    if (filters.role) {
      users = users.filter(([_, userData]) => 
        userData.permissions?.role === filters.role
      );
    }
    
    const paginatedUsers = users.slice(offset, offset + parseInt(limit));
    
    return {
      users: Object.fromEntries(paginatedUsers),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: users.length
      }
    };
  }

  async getDepartments() {
    const snapshot = await this.db.ref('/departments').once('value');
    return snapshot.val() || {};
  }

  async getApplications() {
    const snapshot = await this.db.ref('/applications').once('value');
    return snapshot.val() || {};
  }

  async getRoles() {
    const snapshot = await this.db.ref('/permissions/roles').once('value');
    return snapshot.val() || {};
  }

  async addLogEntry(type, entry) {
    const logRef = this.db.ref(`/logs/${type}`).push();
    await logRef.set({
      ...entry,
      id: logRef.key,
      timestamp: Date.now()
    });
    return logRef.key;
  }

  async getBakeDocuments(category = null, search = null, publicOnly = true) {
    let query = this.db.ref('/bake/documents');
    
    if (publicOnly) {
      query = query.orderByChild('isPublic').equalTo(true);
    }
    
    const snapshot = await query.once('value');
    let documents = Object.entries(snapshot.val() || {});
    
    if (category) {
      documents = documents.filter(([_, doc]) => doc.category === category);
    }
    
    if (search) {
      const searchLower = search.toLowerCase();
      documents = documents.filter(([_, doc]) => 
        doc.title?.toLowerCase().includes(searchLower) ||
        doc.content?.toLowerCase().includes(searchLower) ||
        doc.tags?.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }
    
    return Object.fromEntries(documents);
  }

  async getBakeDocument(documentId) {
    const snapshot = await this.db.ref(`/bake/documents/${documentId}`).once('value');
    return snapshot.val();
  }

  async createBakeDocument(documentData) {
    const documentRef = this.db.ref('/bake/documents').push();
    const now = Date.now();
    
    const fullDocumentData = {
      id: documentRef.key,
      ...documentData,
      metadata: {
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        lastReviewed: null,
        reviewedBy: null
      },
      analytics: {
        views: 0,
        searches: 0,
        helpful: 0,
        notHelpful: 0
      }
    };
    
    await documentRef.set(fullDocumentData);
    return documentRef.key;
  }

  async incrementDocumentViews(documentId) {
    const viewRef = this.db.ref(`/bake/documents/${documentId}/analytics/views`);
    await viewRef.transaction(currentViews => (currentViews || 0) + 1);
  }

  async processMAIAQuery(message, userId, sessionId) {
    const conversationRef = this.db.ref(`/bake/maia/conversations/${sessionId || 'session_' + Date.now()}`);
    
    const userMessage = {
      id: 'msg_' + Date.now(),
      type: 'user',
      content: message,
      timestamp: Date.now()
    };
    
    const searchResults = await this.searchBakeForQuery(message);
    const confidence = this.calculateResponseConfidence(searchResults, message);
    
    const maiaResponse = {
      id: 'msg_' + (Date.now() + 1),
      type: 'maia',
      content: this.generateMAIAResponse(searchResults, message),
      sources: searchResults.map(result => result.id),
      confidence: confidence,
      timestamp: Date.now() + 1
    };
    
    const conversationData = {
      userId: userId,
      sessionId: sessionId || 'session_' + Date.now(),
      messages: [userMessage, maiaResponse],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await conversationRef.set(conversationData);
    
    await this.db.ref('/bake/maia/analytics/totalQueries').transaction(count => (count || 0) + 1);
    
    return {
      response: maiaResponse.content,
      sources: maiaResponse.sources,
      confidence: maiaResponse.confidence,
      sessionId: conversationData.sessionId
    };
  }

  async searchBakeForQuery(query) {
    const snapshot = await this.db.ref('/bake/documents').orderByChild('isPublic').equalTo(true).once('value');
    const documents = snapshot.val() || {};
    
    const queryLower = query.toLowerCase();
    const results = [];
    
    Object.entries(documents).forEach(([id, doc]) => {
      let relevanceScore = 0;
      
      if (doc.title?.toLowerCase().includes(queryLower)) relevanceScore += 10;
      if (doc.content?.toLowerCase().includes(queryLower)) relevanceScore += 5;
      if (doc.tags?.some(tag => tag.toLowerCase().includes(queryLower))) relevanceScore += 3;
      
      if (relevanceScore > 0) {
        results.push({
          id,
          title: doc.title,
          content: doc.content?.substring(0, 200) + '...',
          relevanceScore
        });
      }
    });
    
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 3);
  }

  calculateResponseConfidence(searchResults, query) {
    if (searchResults.length === 0) return 0.1;
    if (searchResults.length === 1) return 0.6;
    if (searchResults[0].relevanceScore > 8) return 0.9;
    return 0.7;
  }

  generateMAIAResponse(searchResults, query) {
    if (searchResults.length === 0) {
      return "I couldn't find specific information about that in our documentation. Please try rephrasing your question or contact support for assistance.";
    }
    
    const topResult = searchResults[0];
    let response = `Based on our documentation, here's what I found:\n\n${topResult.content}`;
    
    if (searchResults.length > 1) {
      response += `\n\nI also found related information in ${searchResults.length - 1} other document(s).`;
    }
    
    response += "\n\nWould you like me to search for more specific information?";
    
    return response;
  }

  async getOAMUserProfile(userId) {
    const [userSnapshot, oamSnapshot] = await Promise.all([
      this.db.ref(`/users/${userId}`).once('value'),
      this.db.ref(`/oam/userProfiles/${userId}`).once('value')
    ]);
    
    const userData = userSnapshot.val();
    const oamData = oamSnapshot.val();
    
    if (!userData) return null;
    
    const profile = {
      basicInfo: {
        robloxId: userData.profile?.robloxId,
        username: userData.profile?.username,
        displayName: userData.profile?.displayName,
        avatarUrl: userData.profile?.avatarUrl
      },
      platformData: {
        accountStatus: userData.activity?.isActive ? 'active' : 'inactive',
        joinDate: userData.activity?.createdAt,
        lastLogin: userData.activity?.lastSeen,
        permissions: userData.permissions
      },
      robloxData: oamData?.robloxData || {
        gameStats: {
          workerPoints: 0,
          experience: 0,
          level: 1,
          totalPlaytime: 0,
          lastSeen: null
        },
        inventory: {
          items: [],
          currency: 0
        }
      },
      discordData: oamData?.discordData || {
        userId: null,
        username: null,
        roles: [],
        joinDate: null,
        messageCount: 0,
        lastActivity: null
      },
      moderation: {
        warnings: userData.moderation?.warnings || 0,
        isBanned: userData.moderation?.isBanned || false,
        banReason: userData.moderation?.banReason,
        banExpires: userData.moderation?.banExpires,
        notes: oamData?.moderation?.notes || []
      },
      analytics: oamData?.analytics || {
        engagementScore: 50,
        activityPattern: 'unknown',
        preferredActivities: [],
        riskLevel: 'low'
      }
    };
    
    return profile;
  }

  async updateGameData(userId, updates, performedBy) {
    const updateData = {};
    const now = Date.now();
    
    if (updates.workerPoints !== undefined) {
      updateData['robloxData/gameStats/workerPoints'] = updates.workerPoints;
    }
    if (updates.experience !== undefined) {
      updateData['robloxData/gameStats/experience'] = updates.experience;
      updateData['robloxData/gameStats/level'] = Math.floor(updates.experience / 100) + 1;
    }
    if (updates.items !== undefined) {
      updateData['robloxData/inventory/items'] = updates.items;
    }
    
    updateData['robloxData/gameStats/lastSeen'] = now;
    
    await this.db.ref(`/oam/userProfiles/${userId}`).update(updateData);
    
    const actionId = await this.addLogEntry('oam_actions', {
      type: 'game_data_update',
      targetUser: userId,
      performedBy: performedBy,
      changes: updates,
      timestamp: now
    });
    
    return actionId;
  }

  async createModerationAction(userId, type, reason, severity, duration, performedBy) {
    const actionRef = this.db.ref('/oam/actions').push();
    const now = Date.now();
    
    const actionData = {
      id: actionRef.key,
      type: type,
      targetUser: userId,
      performedBy: performedBy,
      details: {
        reason: reason,
        severity: severity,
        duration: duration
      },
      timestamp: now,
      reversible: type !== 'permanent_ban',
      reversed: false
    };
    
    await actionRef.set(actionData);
    
    if (type === 'warning') {
      await this.db.ref(`/users/${userId}/moderation/warnings`).transaction(count => (count || 0) + 1);
      
      const warningRef = this.db.ref(`/oam/userProfiles/${userId}/moderation/warnings`).push();
      await warningRef.set({
        id: warningRef.key,
        reason: reason,
        issuedBy: performedBy,
        issuedAt: now,
        severity: severity
      });
    }
    
    if (type === 'ban' || type === 'permanent_ban') {
      await this.db.ref(`/users/${userId}/moderation`).update({
        isBanned: true,
        banReason: reason,
        banExpires: type === 'permanent_ban' ? null : now + (duration * 1000)
      });
    }
    
    return actionData;
  }

  async getAvailableForms(userId, userLevel) {
    const snapshot = await this.db.ref('/forms/templates').orderByChild('status').equalTo('active').once('value');
    const forms = snapshot.val() || {};
    
    const availableForms = {};
    
    for (const [formId, form] of Object.entries(forms)) {
      const eligible = await this.checkFormEligibility(formId, userId);
      if (eligible.eligible) {
        availableForms[formId] = {
          id: formId,
          title: form.title,
          description: form.description,
          department: form.department,
          estimatedTime: this.calculateFormTime(form.fields)
        };
      }
    }
    
    return availableForms;
  }

  async getForm(formId) {
    const snapshot = await this.db.ref(`/forms/templates/${formId}`).once('value');
    return snapshot.val();
  }

  async checkFormEligibility(formId, userId) {
    const [formSnapshot, userSnapshot] = await Promise.all([
      this.db.ref(`/forms/templates/${formId}`).once('value'),
      this.db.ref(`/users/${userId}`).once('value')
    ]);
    
    const form = formSnapshot.val();
    const user = userSnapshot.val();
    
    if (!form || !user) {
      return { eligible: false, reason: 'Form or user not found' };
    }
    
    const requirements = form.requirements || {};
    
    if (requirements.minLevel && user.permissions?.level < requirements.minLevel) {
      return { eligible: false, reason: `Minimum level ${requirements.minLevel} required` };
    }
    
    if (requirements.minDaysActive) {
      const daysSinceJoin = (Date.now() - user.activity?.createdAt) / (1000 * 60 * 60 * 24);
      if (daysSinceJoin < requirements.minDaysActive) {
        return { eligible: false, reason: `Must be active for ${requirements.minDaysActive} days` };
      }
    }
    
    if (requirements.requiredDepartments && !requirements.requiredDepartments.includes(user.permissions?.department)) {
      return { eligible: false, reason: 'Department requirement not met' };
    }
    
    if (requirements.blacklistedRoles && requirements.blacklistedRoles.includes(user.permissions?.role)) {
      return { eligible: false, reason: 'Role restriction applies' };
    }
    
    const existingSubmission = await this.db.ref('/forms/submissions')
      .orderByChild('userId').equalTo(userId)
      .orderByChild('formId').equalTo(formId)
      .once('value');
    
    if (existingSubmission.exists()) {
      const submissions = Object.values(existingSubmission.val());
      const pendingOrApproved = submissions.some(sub => sub.status === 'pending' || sub.status === 'approved');
      if (pendingOrApproved) {
        return { eligible: false, reason: 'Already submitted or approved' };
      }
    }
    
    return { eligible: true, reason: null };
  }

  async submitForm(formId, userId, responses) {
    const submissionRef = this.db.ref('/forms/submissions').push();
    const form = await this.getForm(formId);
    
    const evaluation = await this.evaluateFormSubmission(form, responses);
    
    const submissionData = {
      id: submissionRef.key,
      formId: formId,
      userId: userId,
      status: evaluation.recommendation === 'approve' ? 'approved' : 
              evaluation.recommendation === 'reject' ? 'rejected' : 'pending',
      responses: responses,
      evaluation: {
        automated: evaluation,
        manual: null
      },
      submittedAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await submissionRef.set(submissionData);
    
    await this.db.ref(`/forms/templates/${formId}/analytics/totalSubmissions`).transaction(count => (count || 0) + 1);
    
    if (submissionData.status === 'approved') {
      await this.db.ref(`/forms/templates/${formId}/analytics/approved`).transaction(count => (count || 0) + 1);
    } else if (submissionData.status === 'rejected') {
      await this.db.ref(`/forms/templates/${formId}/analytics/rejected`).transaction(count => (count || 0) + 1);
    } else {
      await this.db.ref(`/forms/templates/${formId}/analytics/pending`).transaction(count => (count || 0) + 1);
    }
    
    return submissionData;
  }

  async evaluateFormSubmission(form, responses) {
    let totalScore = 0;
    let maxScore = 0;
    const evaluation = {
      grammarScore: 0,
      lengthScore: 0,
      quizScore: 0,
      overallScore: 0,
      recommendation: 'pending'
    };
    
    for (const field of form.fields) {
      const response = responses[field.id];
      
      if (field.type === 'text' && field.validation) {
        const textScore = this.evaluateTextResponse(response, field.validation);
        evaluation.grammarScore += textScore.grammar;
        evaluation.lengthScore += textScore.length;
        totalScore += textScore.total;
        maxScore += 100;
      }
      
      if (field.type === 'quiz') {
        const quizScore = this.evaluateQuizResponse(response, field);
        evaluation.quizScore = quizScore;
        totalScore += quizScore;
        maxScore += 100;
      }
    }
    
    evaluation.overallScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    
    const thresholds = form.autoEvaluation?.thresholds || {
      autoApprove: 85,
      autoReject: 40,
      manualReview: 60
    };
    
    if (evaluation.overallScore >= thresholds.autoApprove) {
      evaluation.recommendation = 'approve';
    } else if (evaluation.overallScore <= thresholds.autoReject) {
      evaluation.recommendation = 'reject';
    } else {
      evaluation.recommendation = 'review';
    }
    
    return evaluation;
  }

  evaluateTextResponse(response, validation) {
    const result = { grammar: 0, length: 0, total: 0 };
    
    if (!response || typeof response !== 'string') {
      return result;
    }
    
    if (validation.minLength && response.length >= validation.minLength) {
      result.length = 100;
    } else if (validation.minLength) {
      result.length = Math.min(100, (response.length / validation.minLength) * 100);
    }
    
    if (validation.grammarCheck) {
      const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const avgWordsPerSentence = response.split(/\s+/).length / Math.max(sentences.length, 1);
      const hasCapitalization = /^[A-Z]/.test(response.trim());
      const hasPunctuation = /[.!?]$/.test(response.trim());
      
      let grammarScore = 0;
      if (avgWordsPerSentence >= 5) grammarScore += 25;
      if (hasCapitalization) grammarScore += 25;
      if (hasPunctuation) grammarScore += 25;
      if (sentences.length >= 2) grammarScore += 25;
      
      result.grammar = grammarScore;
    }
    
    result.total = (result.grammar + result.length) / 2;
    return result;
  }

  evaluateQuizResponse(response, field) {
    if (!response || !response.answers || !Array.isArray(response.answers)) {
      return 0;
    }
    
    let correctAnswers = 0;
    const totalQuestions = field.questions.length;
    
    field.questions.forEach((question, index) => {
      if (response.answers[index] === question.correct) {
        correctAnswers++;
      }
    });
    
    return Math.round((correctAnswers / totalQuestions) * 100);
  }

  calculateFormTime(fields) {
    let estimatedMinutes = 5;
    
    fields.forEach(field => {
      if (field.type === 'text') {
        estimatedMinutes += field.validation?.minLength ? Math.ceil(field.validation.minLength / 50) : 2;
      } else if (field.type === 'quiz') {
        estimatedMinutes += field.questions ? field.questions.length * 0.5 : 2;
      } else {
        estimatedMinutes += 1;
      }
    });
    
    return Math.round(estimatedMinutes);
  }

  async getUserSubmissions(userId) {
    const snapshot = await this.db.ref('/forms/submissions').orderByChild('userId').equalTo(userId).once('value');
    const submissions = snapshot.val() || {};
    
    const enrichedSubmissions = {};
    
    for (const [submissionId, submission] of Object.entries(submissions)) {
      const form = await this.getForm(submission.formId);
      enrichedSubmissions[submissionId] = {
        ...submission,
        formTitle: form?.title || 'Unknown Form',
        formDepartment: form?.department || 'Unknown'
      };
    }
    
    return enrichedSubmissions;
  }

  async getCourses(targetRoles = null, difficulty = null) {
    let query = this.db.ref('/courses/courses');
    
    const snapshot = await query.once('value');
    const courses = snapshot.val() || {};
    
    let filteredCourses = Object.entries(courses);
    
    if (targetRoles) {
      filteredCourses = filteredCourses.filter(([_, course]) => 
        course.targetRoles?.some(role => targetRoles.includes(role))
      );
    }
    
    if (difficulty) {
      filteredCourses = filteredCourses.filter(([_, course]) => course.difficulty === difficulty);
    }
    
    return Object.fromEntries(filteredCourses);
  }

  async getCourse(courseId) {
    const snapshot = await this.db.ref(`/courses/courses/${courseId}`).once('value');
    return snapshot.val();
  }

  async enrollInCourse(courseId, userId) {
    const enrollmentRef = this.db.ref('/courses/enrollments').push();
    
    const enrollmentData = {
      userId: userId,
      courseId: courseId,
      status: 'in_progress',
      progress: {
        currentModule: null,
        completedModules: [],
        overallProgress: 0,
        timeSpent: 0
      },
      scores: {},
      enrolledAt: Date.now(),
      lastAccessed: Date.now(),
      completedAt: null
    };
    
    await enrollmentRef.set(enrollmentData);
    
    await this.db.ref(`/courses/courses/${courseId}/analytics/enrollments`).transaction(count => (count || 0) + 1);
    
    return enrollmentRef.key;
  }

  async getUserCourseProgress(userId, courseId) {
    const snapshot = await this.db.ref('/courses/enrollments')
      .orderByChild('userId').equalTo(userId)
      .once('value');
    
    const enrollments = snapshot.val() || {};
    const enrollment = Object.values(enrollments).find(e => e.courseId === courseId);
    
    return enrollment || null;
  }

  async updateCourseProgress(userId, courseId, moduleId, score = null) {
    const snapshot = await this.db.ref('/courses/enrollments')
      .orderByChild('userId').equalTo(userId)
      .once('value');
    
    const enrollments = snapshot.val() || {};
    const enrollmentEntry = Object.entries(enrollments).find(([_, e]) => e.courseId === courseId);
    
    if (!enrollmentEntry) return null;
    
    const [enrollmentId, enrollment] = enrollmentEntry;
    const course = await this.getCourse(courseId);
    
    const updates = {
      [`progress/currentModule`]: moduleId,
      [`progress/completedModules`]: [...(enrollment.progress.completedModules || []), moduleId],
      [`lastAccessed`]: Date.now()
    };
    
    if (score !== null) {
      updates[`scores/${moduleId}`] = score;
    }
    
    const completedCount = updates[`progress/completedModules`].length;
    const totalModules = course.modules?.length || 1;
    updates[`progress/overallProgress`] = Math.round((completedCount / totalModules) * 100);
    
    if (completedCount === totalModules) {
      updates[`status`] = 'completed';
      updates[`completedAt`] = Date.now();
      
      await this.db.ref(`/courses/courses/${courseId}/analytics/completions`).transaction(count => (count || 0) + 1);
      
      if (course.rewards?.xp) {
        await this.addUserXP(userId, course.rewards.xp);
      }
    }
    
    await this.db.ref(`/courses/enrollments/${enrollmentId}`).update(updates);
    
    return updates;
  }

  async addUserXP(userId, xpAmount) {
    await this.db.ref(`/users/${userId}/gameData/experience`).transaction(currentXP => (currentXP || 0) + xpAmount);
    
    const logEntry = {
      userId: userId,
      type: 'xp_gained',
      amount: xpAmount,
      source: 'course_completion',
      timestamp: Date.now()
    };
    
    await this.addLogEntry('xp_transactions', logEntry);
  }

  async getCourseLeaderboard(period = 'weekly') {
    const snapshot = await this.db.ref(`/courses/leaderboards/${period}`).once('value');
    return snapshot.val() || [];
  }

  async getPartners(status = 'active') {
    const snapshot = await this.db.ref('/partners/organizations').orderByChild('status').equalTo(status).once('value');
    return snapshot.val() || {};
  }

  async getPartner(partnerId) {
    const snapshot = await this.db.ref(`/partners/organizations/${partnerId}`).once('value');
    return snapshot.val();
  }

  async createPartnerEvent(partnerId, eventData, createdBy) {
    const eventRef = this.db.ref('/partners/events').push();
    
    const fullEventData = {
      id: eventRef.key,
      partnerId: partnerId,
      ...eventData,
      participants: {
        registered: 0,
        attended: 0,
        maxCapacity: eventData.maxCapacity || 100
      },
      createdBy: createdBy,
      createdAt: Date.now()
    };
    
    await eventRef.set(fullEventData);
    return eventRef.key;
  }

  async getPartnerEvents(partnerId, status = null) {
    let query = this.db.ref('/partners/events').orderByChild('partnerId').equalTo(partnerId);
    
    const snapshot = await query.once('value');
    let events = Object.entries(snapshot.val() || {});
    
    if (status) {
      events = events.filter(([_, event]) => event.status === status);
    }
    
    return Object.fromEntries(events);
  }

  async createPartnerAnnouncement(partnerId, announcementData, createdBy) {
    const announcementRef = this.db.ref('/partners/announcements').push();
    
    const fullAnnouncementData = {
      id: announcementRef.key,
      partnerId: partnerId,
      ...announcementData,
      engagement: {
        views: 0,
        likes: 0,
        shares: 0,
        comments: 0
      },
      publishedAt: Date.now(),
      expiresAt: announcementData.expiresAt || null
    };
    
    await announcementRef.set(fullAnnouncementData);
    return announcementRef.key;
  }

  async getSessions(filters = {}) {
    let query = this.db.ref('/sessions/sessions');
    
    const snapshot = await query.once('value');
    let sessions = Object.entries(snapshot.val() || {});
    
    if (filters.type) {
      sessions = sessions.filter(([_, session]) => session.type === filters.type);
    }
    
    if (filters.department) {
      sessions = sessions.filter(([_, session]) => session.department === filters.department);
    }
    
    if (filters.status) {
      sessions = sessions.filter(([_, session]) => session.status === filters.status);
    }
    
    if (filters.date) {
      sessions = sessions.filter(([_, session]) => session.schedule?.date === filters.date);
    }
    
    return Object.fromEntries(sessions);
  }

  async createSession(sessionData, createdBy) {
    const sessionRef = this.db.ref('/sessions/sessions').push();
    
    const fullSessionData = {
      id: sessionRef.key,
      ...sessionData,
      capacity: {
        min: sessionData.capacity?.min || 1,
        max: sessionData.capacity?.max || 10,
        current: 0
      },
      status: 'scheduled',
      attendees: [],
      analytics: {
        actualAttendance: 0,
        completionRate: 0,
        averageRating: 0,
        feedback: []
      },
      createdBy: createdBy,
      createdAt: Date.now()
    };
    
    await sessionRef.set(fullSessionData);
    return sessionRef.key;
  }

  async registerForSession(sessionId, userId) {
    const sessionSnapshot = await this.db.ref(`/sessions/sessions/${sessionId}`).once('value');
    const session = sessionSnapshot.val();
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    if (session.capacity.current >= session.capacity.max) {
      throw new Error('Session is full');
    }
    
    const userEligible = await this.checkSessionEligibility(session, userId);
    if (!userEligible.eligible) {
      throw new Error(userEligible.reason);
    }
    
    const attendeeData = {
      userId: userId,
      status: 'confirmed',
      registeredAt: Date.now()
    };
    
    await this.db.ref(`/sessions/sessions/${sessionId}/attendees`).push(attendeeData);
    await this.db.ref(`/sessions/sessions/${sessionId}/capacity/current`).transaction(count => (count || 0) + 1);
    
    return true;
  }

  async checkSessionEligibility(session, userId) {
    const userSnapshot = await this.db.ref(`/users/${userId}`).once('value');
    const user = userSnapshot.val();
    
    if (!user) {
      return { eligible: false, reason: 'User not found' };
    }
    
    if (session.requirements?.minLevel && user.permissions?.level < session.requirements.minLevel) {
      return { eligible: false, reason: `Minimum level ${session.requirements.minLevel} required` };
    }
    
    if (session.requirements?.departments && !session.requirements.departments.includes(user.permissions?.department)) {
      return { eligible: false, reason: 'Department requirement not met' };
    }
    
    const alreadyRegistered = session.attendees?.some(attendee => attendee.userId === userId);
    if (alreadyRegistered) {
      return { eligible: false, reason: 'Already registered for this session' };
    }
    
    return { eligible: true, reason: null };
  }

  async getUserAvailability(userId) {
    const snapshot = await this.db.ref(`/sessions/availability/${userId}`).once('value');
    return snapshot.val();
  }

  async updateUserAvailability(userId, schedule, preferences) {
    const availabilityData = {
      userId: userId,
      schedule: schedule,
      preferences: preferences,
      updatedAt: Date.now()
    };
    
    await this.db.ref(`/sessions/availability/${userId}`).set(availabilityData);
    return true;
  }

  async getUVMUserMetrics(userId) {
    const snapshot = await this.db.ref(`/uvm/userMetrics/${userId}`).once('value');
    return snapshot.val();
  }

  async updateUVMMetrics(userId, metrics) {
    const updates = {
      ...metrics,
      lastUpdated: Date.now()
    };
    
    await this.db.ref(`/uvm/userMetrics/${userId}`).update(updates);
    return true;
  }

  async getUserSegment(userId) {
    const metrics = await this.getUVMUserMetrics(userId);
    if (!metrics) return 'new_user';
    
    const segmentsSnapshot = await this.db.ref('/uvm/segments').once('value');
    const segments = segmentsSnapshot.val() || {};
    
    for (const [segmentName, segment] of Object.entries(segments)) {
      const criteria = segment.criteria;
      let meetsAllCriteria = true;
      
      if (criteria.minEngagement && metrics.valueScore?.overall < criteria.minEngagement) {
        meetsAllCriteria = false;
      }
      
      if (criteria.minRetention && metrics.valueScore?.retention < criteria.minRetention) {
        meetsAllCriteria = false;
      }
      
      if (criteria.minActivity && metrics.engagementMetrics?.weeklyActivity < criteria.minActivity) {
        meetsAllCriteria = false;
      }
      
      if (meetsAllCriteria) {
        return segmentName;
      }
    }
    
    return 'standard_user';
  }
}
