import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizePhone, hashIdentityValue } from '../src/server/services/normalizer';

describe('Normalizer Service', () => {
  it('normalizes email addresses correctly', () => {
    expect(normalizeEmail('John.Doe@Example.COM ')).toBe('john.doe@example.com');
    expect(normalizeEmail('CUSTOMER@SHOP.COM')).toBe('customer@shop.com');
  });

  it('throws on invalid emails', () => {
    expect(() => normalizeEmail('')).toThrow();
    expect(() => normalizeEmail('invalidemail.com')).toThrow();
  });

  it('normalizes phone numbers to E.164 standard', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('5551234567', '+1')).toBe('+15551234567');
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });

  it('produces deterministic SHA-256 identity hashes', () => {
    const hash1 = hashIdentityValue('john.doe@example.com');
    const hash2 = hashIdentityValue('john.doe@example.com');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });
});
