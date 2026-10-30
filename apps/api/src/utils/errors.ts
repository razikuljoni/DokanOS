import { ERROR_CODES, type ErrorCode } from '@dokanos/shared';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, string[]>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, string[]>): AppError {
    return new AppError(400, ERROR_CODES.VALIDATION, message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'Insufficient permissions'): AppError {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static planLimit(message: string): AppError {
    return new AppError(403, ERROR_CODES.PLAN_LIMIT, message);
  }

  static insufficientStock(message: string): AppError {
    return new AppError(409, ERROR_CODES.INSUFFICIENT_STOCK, message);
  }
}
