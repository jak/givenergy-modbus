import { describe, it, expect } from 'vitest';
import { detectGeneration, type InverterGeneration } from '../src/generation.js';

describe('detectGeneration', () => {
  it('detects CE prefix as gen2', () => {
    expect(detectGeneration('CE1234G567')).toBe('gen2');
  });

  it('detects EE prefix as gen3', () => {
    expect(detectGeneration('EE1234G567')).toBe('gen3');
  });

  it('detects SA prefix as three_phase', () => {
    expect(detectGeneration('SA1234B567')).toBe('three_phase');
  });

  it('returns gen2 for unknown prefix as safe default', () => {
    expect(detectGeneration('XX1234G567')).toBe('gen2');
  });

  it('returns gen2 for empty string', () => {
    expect(detectGeneration('')).toBe('gen2');
  });
});
