import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestContext } from "./utils/requestContext";
import { authMiddleware } from "./middleware/authMiddleware";
import chatRoutes from "./routes/chat.routes";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.set('trust proxy', 2)
// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'",
        "wss://*.vops360.com",
        "wss://*.vops360.co.uk",
        "https://*.vops360.com",
        "https://*.vops360.co.uk"
      ], // allow both ws/wss and https origins for vops360 domains
      fontSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      childSrc: ["'self'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: false, // if needed for cross-origin requests
  crossOriginResourcePolicy: { policy: "cross-origin" }, // allow cross-origin requests
  crossOriginOpenerPolicy: { policy: "same-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes by default
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // 100 requests per windowMs by default
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting to all routes
app.use(limiter);



// Handle preflight requests explicitly
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {

    // Set CORS headers for preflight
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, x-context-id, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');

    res.status(200).end();
    return;
  }
  next();
});

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log("🔍 [CORS] No origin provided, allowing");
      return callback(null, true);
    }

    console.log("🔍 [CORS] Checking origin:", origin);

    // Check if origin ends with vops360.com or vops360.co.uk
    if (origin.endsWith('vops360.com') || origin.endsWith('vops360.co.uk') || origin.startsWith('http://localhost:')) {
      console.log("🔍 [CORS] Allowing origin:", origin);
      return callback(null, true);
    }

    console.log("🔍 [CORS] Rejecting origin:", origin);
    // Reject other origins
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-tenant-id",
    "x-context-id",
    "Accept",
    "Origin",
    "X-Requested-With"
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));



// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Request context middleware
app.use((req, res, next) => {
  requestContext.run({}, async () => {
    next();
  });
});

// Apply auth middleware to all routes except health check
app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  authMiddleware(req, res, next);
});

// Chat routes
app.use("/api/chats", chatRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ [Error]:', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    timestamp: new Date().toISOString()
  });
});

// Add debugging middleware to see unmatched routes
app.use((req, res, next) => {
  console.log("🔍 [Unmatched Route] Method:", req.method, "Path:", req.path);
  console.log("🔍 [Unmatched Route] Headers:", req.headers);
  console.log("🔍 [Unmatched Route] Body:", req.body);
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.path,
    availableRoutes: [
      "GET /api/chats/users",
      "GET /api/chats/users/:userId/chats",
      "GET /api/chats/chats/:chatId/messages/:userId",
      "POST /api/chats/chats",
      "POST /api/chats/chats/multiple",
      "POST /api/chats/chats/teams",
      "DELETE /api/chats/chats/:chatId/:userId?",
      "PUT /api/chats/chats/:chatId/messages/:messageId",
      "DELETE /api/chats/messages/:messageId",
      "POST /api/chats/export",
      "POST /api/chats/messages",
      "POST /api/chats/chats/:chatId/exit",
      "GET /api/chats/chats/group/:userId",
      "POST /api/chats/create/group",
      "POST /api/chats/create",
      "POST /api/chats/create/team"
    ]
  });
});

export default app;
