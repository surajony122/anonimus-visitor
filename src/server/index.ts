import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

import eventsRouter from './routes/events';
import identityRouter from './routes/identity';
import visitorsRouter from './routes/visitors';
import analyticsRouter from './routes/analytics';
import customersRouter from './routes/customers';
import privacyRouter from './routes/privacy';
import webhooksRouter from './routes/webhooks';
import authRouter from './routes/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Middlewares
app.use(helmet({
  contentSecurityPolicy: false, // Allow embedding in Shopify admin iframe
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
  if (!req.path.startsWith('/client')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// API Routes
app.use('/api/events', eventsRouter);
app.use('/api/identity', identityRouter);
app.use('/api/visitors', visitorsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/privacy', privacyRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/auth', authRouter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Nitro-Like Shopify Visitor Intelligence Server',
    version: '1.0.0',
  });
});

// Serve storefront tracking scripts directly
app.use('/scripts', express.static(path.resolve(__dirname, '../storefront')));

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Nitro Visitor Intelligence Server listening on port ${PORT}`);
    console.log(`📡 Ingestion endpoint: http://localhost:${PORT}/api/events`);
    console.log(`🛡️  Admin API ready: http://localhost:${PORT}/api/analytics/overview`);
  });
}

export default app;
