import { Request, Response, NextFunction } from 'express';
const { validationResult } = require('express-validator');

/**
 * Global validation error handler middleware
 * This middleware checks for validation errors and returns them in a consistent format
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array().map((err: any) => ({
        field: err.type === 'field' ? err.path : undefined,
        message: err.msg,
        value: err.type === 'field' ? err.value : undefined
      }))
    });
  }
  next();
}; 