/**
 * Run: npx tsx --test src/voice/__tests__/allowed-layouts.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_LAYOUT_NAMES,
  detectForbiddenLayoutMention,
  isAllowedLayoutName,
} from '../allowed-layouts';

describe('allowed-layouts', () => {
  it('lists exactly five PDF projects', () => {
    assert.equal(ALLOWED_LAYOUT_NAMES.length, 5);
    assert.deepEqual(ALLOWED_LAYOUT_NAMES, [
      'UK Square',
      'Sridevi Lake View',
      'CNM Apex City',
      'Alliance Serene Phase 2',
      'Adhya Enclave',
    ]);
  });

  it('accepts only allowed layout names', () => {
    assert.equal(isAllowedLayoutName('UK Square'), true);
    assert.equal(isAllowedLayoutName('Alliance Serene Phase 2'), true);
    assert.equal(isAllowedLayoutName('Jeevan Vihar'), false);
    assert.equal(isAllowedLayoutName('Dhatri Square'), false);
  });

  it('detects forbidden layout mentions in AI text', () => {
    assert.equal(detectForbiddenLayoutMention('We also have Jeevan Vihar near Ring Road'), 'Jeevan Vihar');
    assert.equal(detectForbiddenLayoutMention('Dhatri Square is another option'), 'Dhatri Square');
    assert.equal(detectForbiddenLayoutMention('UK Square is on the highway'), null);
  });
});
