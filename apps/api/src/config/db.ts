import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

let memoryReplSet: { stop: () => Promise<unknown>; getUri: () => string } | null = null;
let isConnected = false;

export async function connectDatabase(overrideUri?: string): Promise<string> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection.host;
  }

  const targetUri = overrideUri ?? env.MONGODB_URI;

  try {
    await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 3000,
    });
    isConnected = true;
    logger.info('Connected to MongoDB', { uri: targetUri.replace(/\/\/.*@/, '//***@') });
    return targetUri;
  } catch (err) {
    if (overrideUri || env.NODE_ENV === 'production') {
      throw err;
    }

    logger.warn(
      'Primary MONGODB_URI unreachable in development; starting in-memory MongoDB Replica Set (MongoMemoryReplSet)',
      { reason: err instanceof Error ? err.message : String(err) },
    );

    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    memoryReplSet = replSet;
    const memUri = replSet.getUri('dokanos');

    await mongoose.connect(memUri);
    isConnected = true;
    logger.info('Connected to in-memory MongoDB Replica Set (transactions enabled)');
    return memUri;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryReplSet) {
    await memoryReplSet.stop();
    memoryReplSet = null;
  }
  isConnected = false;
}
