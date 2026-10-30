import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiErrorResponse } from '@dokanos/shared';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const payload: ApiErrorResponse = {
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: 'Endpoint not found',
    },
  };
  res.status(404).json(payload);
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    const payload: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(payload);
    return;
  }

  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const pathKey = issue.path.join('.') || 'root';
      if (!fieldErrors[pathKey]) {
        fieldErrors[pathKey] = [];
      }
      fieldErrors[pathKey].push(issue.message);
    }

    const payload: ApiErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION,
        message: 'Validation failed',
        details: fieldErrors,
      },
    };
    res.status(400).json(payload);
    return;
  }

  logger.error('Unhandled API error', {
    message: err instanceof Error ? err.message : String(err),
  });

  const payload: ApiErrorResponse = {
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    },
  };
  res.status(500).json(payload);
};
