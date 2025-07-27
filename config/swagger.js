import swaggerJsDoc from "swagger-jsdoc";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bristo Corporate Platform API",
      version: "1.0.0",
      description: "Comprehensive API documentation for Bristo Corporate Platform",
      license: {
        name: "MIT",
        url: "https://spdx.org/licenses/MIT.html",
      },
      contact: {
        name: "Bristo Corporate",
        url: "https://mybristo.glitch.me",
        email: "support@bristo.com",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://mybristo.glitch.me",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Firebase JWT token for user authentication",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API key for service-to-service authentication"
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            profile: {
              type: "object",
              properties: {
                robloxId: { type: "string" },
                username: { type: "string" },
                displayName: { type: "string" },
                avatarUrl: { type: "string" },
                bio: { type: "string" },
                themeColor: { type: "string" },
              },
            },
            permissions: {
              type: "object",
              properties: {
                level: { type: "integer" },
                role: { type: "string" },
                department: { type: "string" },
              },
            },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
      {
        ApiKeyAuth: [],
      },
    ],
  },
  apis: ["./routes/*.js"],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

export default swaggerDocs;
