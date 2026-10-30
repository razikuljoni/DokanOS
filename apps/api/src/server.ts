import http from 'node:http';
import { apiApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase } from './config/db.js';
import { initRedis } from './config/redis.js';
import { initSocketServer } from './realtime/socket.js';
import { initInProcessJobsWorker } from './queues/worker.js';
import { seedDemoData } from './seedData.js';

const server = http.createServer(apiApp);
initSocketServer(server);

async function bootstrap(): Promise<void> {
  await connectDatabase();
  initRedis();
  initInProcessJobsWorker();

  if (env.SEED_DEMO) {
    await seedDemoData(false);
  }

  server.listen(env.PORT, () => {
    logger.info(`DokanOS API listening on http://localhost:${env.PORT}`, {
      env: env.NODE_ENV,
    });
  });
}

void bootstrap();

export { server };
