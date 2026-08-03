import { describe, it, expect } from 'vitest';
import { ConflictError, AppError } from '../src/platform/errors.js';

describe('ConflictError', () => {
  it('is a 409 AppError with a stable code', () => {
    const err = new ConflictError('A scan is already running');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('A scan is already running');
  });
});
