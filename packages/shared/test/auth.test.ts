import { describe, expect, it } from 'vitest';
import { AUTH_TOKEN_ERRORS, isAuthTokenError } from '../src/index';

describe('isAuthTokenError', () => {
  it('accepts the four device-flow errors', () => {
    expect(AUTH_TOKEN_ERRORS).toEqual(['authorization_pending', 'slow_down', 'expired_token', 'access_denied']);
    for (const error of AUTH_TOKEN_ERRORS) expect(isAuthTokenError({ error })).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isAuthTokenError({ error: 'unauthorized' })).toBe(false);
    expect(isAuthTokenError({ token: 'tyg_x' })).toBe(false);
    expect(isAuthTokenError(null)).toBe(false);
    expect(isAuthTokenError('slow_down')).toBe(false);
  });
});
