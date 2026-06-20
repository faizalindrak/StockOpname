import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, setToken } from '../lib/db/http.js';

describe('token storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips token', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});