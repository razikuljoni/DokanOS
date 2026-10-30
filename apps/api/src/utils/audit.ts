import { Types } from 'mongoose';
import { AuditLogModel } from '../models/index.js';
import { logger } from '../config/logger.js';

export async function recordAuditLog(params: {
  tenantId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  changes?: Record<string, unknown>;
}): Promise<void> {
  try {
    await AuditLogModel.create({
      tenantId: new Types.ObjectId(params.tenantId),
      userId: new Types.ObjectId(params.userId),
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      changes: params.changes ?? {},
    });
  } catch (err) {
    logger.warn('Failed to write audit log', {
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
