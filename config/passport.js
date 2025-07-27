import passport from "passport";
import axios from "axios";
import { Strategy as OpenIDConnectStrategy } from "passport-openidconnect";
import { Strategy as DiscordStrategy } from "passport-discord";
import admin from "./firebase.js";
import { config } from "./index.js";

// --- Roblox OAuth Strategy ---
const robloxOAuthConfig = {
  issuer: "https://apis.roblox.com/oauth/",
  authorizationURL: "https://apis.roblox.com/oauth/v1/authorize",
  tokenURL: "https://apis.roblox.com/oauth/v1/token",
  userInfoURL: "https://apis.roblox.com/oauth/v1/userinfo",
  clientID: config.roblox.clientId,
  clientSecret: config.roblox.clientSecret,
  callbackURL: config.roblox.callbackUrl,
  scope: ["profile"],
};

// --- Discord OAuth Strategy ---
const discordOAuthConfig = {
  clientID: config.discord.clientId,
  clientSecret: config.discord.clientSecret,
  callbackURL: config.discord.callbackUrl,
  scope: ["identify"],
};

const getRoleConfiguration = (roleKey) => {
  const roles = {
    "president": { level: 10, department: "corporate" },
    "vice_president": { level: 9, department: "corporate" },
    "chairman": { level: 9, department: "corporate" },
    "technical_lead": { level: 8, department: "technical" },
    "moderation_head": { level: 7, department: "moderation" },
    "acquisition_head": { level: 7, department: "hr" },
    "relations_head": { level: 7, department: "pr" },
    "high_rank": { level: 6, department: "operations" },
    "middle_rank": { level: 5, department: "operations" },
    "moderation_associate": { level: 4, department: "moderation" },
    "acquisition_associate": { level: 4, department: "hr" },
    "relations_associate": { level: 4, department: "pr" },
    "high_rank_apprentice": { level: 3, department: "operations" },
    "middle_rank_apprentice": { level: 3, department: "operations" },
    "base_rank_apprentice": { level: 2, department: "general" },
    "moderation_intern": { level: 2, department: "moderation" },
    "acquisition_intern": { level: 2, department: "hr" },
    "relations_intern": { level: 2, department: "pr" },
    "representative": { level: 2, department: "partner" },
    "base_rank": { level: 1, department: "general" }
  };
  return roles[roleKey] || { level: 1, department: "general" };
};

const assignRoleToUser = async (userId, role = "base_rank") => {
  const roleConfig = getRoleConfiguration(role);
  const customClaims = {
    role: role,
    level: roleConfig.level,
    department: roleConfig.department
  };
  await admin.auth().setCustomUserClaims(userId, customClaims);
};

// --- Roblox Strategy ---
passport.use(
  new OpenIDConnectStrategy(robloxOAuthConfig, async (issuer, sub, profile, jwtClaims, accessToken, refreshToken, done) => {
    try {
      const { data: robloxUser } = await axios.get(robloxOAuthConfig.userInfoURL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const email = `${robloxUser.preferred_username}@ropr.me`;

      try {
        const firebaseUser = await admin.auth().getUserByEmail(email);
        const firebaseToken = await admin.auth().createCustomToken(firebaseUser.uid);

        await admin.auth().updateUser(firebaseUser.uid, {
          email,
          displayName: robloxUser.name,
          photoURL: robloxUser.picture,
          emailVerified: true,
        });

        await assignRoleToUser(firebaseUser.uid);

        return done(null, { 
          roblox: robloxUser, 
          firebase: firebaseUser, 
          firebasetoken: firebaseToken 
        });
      } catch {
        const firebaseUser = await admin.auth().createUser({
          email,
          displayName: robloxUser.name,
          photoURL: robloxUser.picture,
          uid: robloxUser.sub,
          emailVerified: false,
        });

        const now = Date.now();
        const defaultRole = "base_rank";
        const roleConfig = getRoleConfiguration(defaultRole);

        const userData = {
          profile: {
            robloxId: robloxUser.sub,
            username: robloxUser.preferred_username,
            displayName: robloxUser.name,
            avatarUrl: robloxUser.picture,
            bio: "",
            themeColor: "#3498db",
            discordId: null
          },
          personal: {
            dateOfBirth: null,
            timezone: null,
            email: null,
            firstName: null,
            lastName: null
          },
          permissions: {
            level: roleConfig.level,
            role: defaultRole,
            department: roleConfig.department
          },
          activity: {
            isActive: false,
            lastSeen: now,
            createdAt: now,
            updatedAt: now
          },
          onboarding: {
            completed: false,
            currentStep: 1,
            enabledViews: []
          },
          assignments: {
            active: {},
            completed: {}
          },
          moderation: {
            warnings: 0,
            isBanned: false,
            banReason: null,
            banExpires: null
          }
        };

        await admin.database().ref(`users/${robloxUser.sub}`).set(userData);
        await assignRoleToUser(firebaseUser.uid, defaultRole);

        const firebaseToken = await admin.auth().createCustomToken(firebaseUser.uid);

        return done(null, { 
          roblox: robloxUser, 
          firebase: firebaseUser, 
          firebasetoken: firebaseToken 
        });
      }
    } catch (error) {
      console.error("Roblox authentication error:", error.response?.data || error.message);
      return done(null, false);
    }
  })
);

// --- Discord Strategy ---
passport.use(
  new DiscordStrategy(discordOAuthConfig, async (accessToken, refreshToken, profile, done) => {
    return done(null, {
      discord: {
        id: profile.id,
        username: profile.username,
        avatar: profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : null
      }
    });
  })
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export default passport;
