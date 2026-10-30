import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { seedDemoData } from '../src/seedData.js';
import { logger } from '../src/config/logger.js';

async function main(): Promise<void> {
  await connectDatabase();
  await seedDemoData(true);
  await disconnectDatabase();
  logger.info('Seed script completed.');
}

void main().catch((err) => {
  logger.error('Seed script failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
