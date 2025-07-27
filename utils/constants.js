export const PERMISSIONS = {
  GUEST: 0,
  BASE_RANK: 1,
  BASE_RANK_APPRENTICE: 2,
  MIDDLE_RANK_APPRENTICE: 3,
  ASSOCIATE: 4,
  MIDDLE_RANK: 5,
  HIGH_RANK: 6,
  DEPARTMENT_HEAD: 7,
  TECHNICAL_LEAD: 8,
  EXECUTIVE: 9,
  PRESIDENT: 10
};

export const DEPARTMENTS = {
  GENERAL: 'general',
  OPERATIONS: 'operations',
  MODERATION: 'moderation',
  HR: 'hr',
  PR: 'pr',
  TECHNICAL: 'technical',
  CORPORATE: 'corporate',
  PARTNER: 'partner'
};

export const ROLES = {
  'base_rank': { level: 1, name: 'Base Rank', department: 'general' },
  'base_rank_apprentice': { level: 2, name: 'Base Rank Apprentice', department: 'general' },
  'middle_rank_apprentice': { level: 3, name: 'Middle Rank Apprentice', department: 'operations' },
  'high_rank_apprentice': { level: 3, name: 'High Rank Apprentice', department: 'operations' },
  'moderation_intern': { level: 2, name: 'Moderation Intern', department: 'moderation' },
  'acquisition_intern': { level: 2, name: 'Acquisition Intern', department: 'hr' },
  'relations_intern': { level: 2, name: 'Relations Intern', department: 'pr' },
  'moderation_associate': { level: 4, name: 'Moderation Associate', department: 'moderation' },
  'acquisition_associate': { level: 4, name: 'Acquisition Associate', department: 'hr' },
  'relations_associate': { level: 4, name: 'Relations Associate', department: 'pr' },
  'middle_rank': { level: 5, name: 'Middle Rank', department: 'operations' },
  'high_rank': { level: 6, name: 'High Rank', department: 'operations' },
  'moderation_head': { level: 7, name: 'Moderation Head', department: 'moderation' },
  'acquisition_head': { level: 7, name: 'Acquisition Department Head', department: 'hr' },
  'relations_head': { level: 7, name: 'Relations Department Head', department: 'pr' },
  'technical_lead': { level: 8, name: 'Technical Team Lead', department: 'technical' },
  'vice_president': { level: 9, name: 'Vice President', department: 'corporate' },
  'chairman': { level: 9, name: 'Chairman', department: 'corporate' },
  'president': { level: 10, name: 'President', department: 'corporate' },
  'representative': { level: 2, name: 'Representative', department: 'partner' }
};

export const ONBOARDING_VIEWS = [
  'training',
  'partner_info',
  'department_updates',
  'announcements',
  'task_management',
  'analytics',
  'communication'
];

export const CACHE_DURATIONS = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 900,
  EXTENDED: 3600
};
