// Environment is loaded via node --env-file=.env (Node 20+) or process.env from the shell.
// dotenv is NOT used as a dependency — keep it simple.

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-secret-key-32chars',
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
  nodeEnv: process.env.NODE_ENV || 'development',
  // DB: prefer DATABASE_URL, fallback to individual vars
  databaseUrl: process.env.DATABASE_URL,
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: parseInt(process.env.DB_PORT || '3306', 10),
  dbUser: process.env.DB_USER || 'frontdesk',
  dbPass: process.env.DB_PASS || 'frontdesk',
  dbName: process.env.DB_NAME || 'frontdesk',
  // Cookie
  cookieSecure: process.env.NODE_ENV === 'production',
  // Frontend build path (relative to backend/src)
  frontendDist: process.env.FRONTEND_DIST || '../../frontend/dist',
};
