import { describe, expect, it } from 'vitest';
import { assetUrl } from '@/lib/webRpc';

describe('browser asset URLs', () => {
  it('keeps the file version as its own query parameter', () => {
    expect(assetUrl('/data/workspaces/w/stills/a.png')).toBe(
      '/api/assets?path=%2Fdata%2Fworkspaces%2Fw%2Fstills%2Fa.png',
    );
    expect(assetUrl('/data/workspaces/w/stills/a.png', '2026-11-08T06:20:00Z')).toBe(
      '/api/assets?path=%2Fdata%2Fworkspaces%2Fw%2Fstills%2Fa.png&v=2026-11-08T06%3A20%3A00Z',
    );
  });
});
