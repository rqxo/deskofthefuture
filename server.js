import express from "express";
import session from "express-session";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cors from "cors";
import dotenv from "dotenv";
import swaggerDocs from './config/swagger.js';
import swaggerUi from 'swagger-ui-express';
import http from "http";
import { WebSocketServer } from "ws";


import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import passport from "./config/passport.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import departmentRoutes from "./routes/departments.js";
import onboardingRoutes from "./routes/onboarding.js";
import applicationRoutes from "./routes/applications.js";
import bakeRoutes from "./routes/bake.js";
import oamRoutes from "./routes/oam.js";
import coursesRoutes from "./routes/courses.js";
import partnersRoutes from "./routes/partners.js";
import sessionsRoutes from "./routes/sessions.js";
import notificationsRoutes from "./routes/notifications.js";
import uvmRoutes from "./routes/uvm.js";
import communityRoutes from "./routes/community.js";
import assignmentsRoutes from "./routes/assignments.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;



app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://mybristo.glitch.me'] 
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));


export const sessions = new Map();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "REGISTER_SESSION" && data.sessionId) {
        console.log(data)
        sessions.set(data.sessionId, ws);
        console.log(sessions)
        console.log("Registered session:", data.sessionId);
      }
    } catch (e) {
      console.error("Invalid WebSocket message", e);
    }
  });
  ws.on("close", () => {
    for (const [id, socket] of sessions.entries()) {
      if (socket === ws) sessions.delete(id);
    }
  });
});


const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { 
    success: false, 
    error: "Rate limit exceeded. Please try again later." 
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || "bristo-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

const swaggerOptions = {
  explorer: true,
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin: 50px 0 }
  `,
  customSiteTitle: "Bristo Corporate API Documentation",
};

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs, swaggerOptions));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/bake", bakeRoutes);
app.use("/api/oam", oamRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/partners", partnersRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/uvm", uvmRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/assignments", assignmentsRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Bristo Corporate API",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`🚀 Bristo Corporate API running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});


export default app;
