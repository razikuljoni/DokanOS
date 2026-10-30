import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { apiApp } from './apps/api/src/app.js';
import { logger } from './apps/api/src/config/logger.js';
import { connectDatabase } from './apps/api/src/config/db.js';
import { initRedis } from './apps/api/src/config/redis.js';
import { initSocketServer } from './apps/api/src/realtime/socket.js';
import { initInProcessJobsWorker } from './apps/api/src/queues/worker.js';
import { seedDemoData } from './apps/api/src/seedData.js';
import { env } from './apps/api/src/config/env.js';

async function startDevBridge(): Promise<void> {
  await connectDatabase();
  initRedis();
  initInProcessJobsWorker();

  if (env.SEED_DEMO) {
    await seedDemoData(false);
  }

  const app = express();
  const port = 3000;

  // Mount the DokanOS Express 5 API application (/health and /api/v1/*)
  app.use(apiApp);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'apps/web/dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  initSocketServer(server);

  server.listen(port, '0.0.0.0', () => {
    logger.info(`DokanOS unified server running on http://0.0.0.0:${port}`);
  });
}

void startDevBridge();
