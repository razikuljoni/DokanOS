import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

interface AccessTokenPayload {
  sub: string;
  tenantId: string | null;
  role: string;
}

let ioInstance: SocketIOServer | null = null;

export function initSocketServer(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const authToken =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!authToken) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }

    try {
      const decoded = jwt.verify(authToken, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      if (!decoded.tenantId) {
        next(new Error('TENANT_MISMATCH'));
        return;
      }
      socket.data.userId = decoded.sub;
      socket.data.tenantId = decoded.tenantId;
      socket.data.role = decoded.role;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const tenantId = socket.data.tenantId as string | undefined;
    if (tenantId) {
      const room = `tenant:${tenantId}`;
      void socket.join(room);
      logger.info('Socket client joined tenant room', { room, userId: socket.data.userId });
    }
  });

  ioInstance = io;
  return io;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`tenant:${tenantId}`).emit(event, payload);
}
