/**
 * Customer identity / salutation unit tests.
 * Run: npx tsx --test src/voice/__tests__/customer-identity.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCustomerCorrection,
  dictionarySize,
  lookupName,
  resolveCustomerIdentity,
  formatIdentityContext,
  CUSTOMER_NAME_AND_ADDRESSING_RULES,
} from '../customer-identity';
import { buildOutboundKannadaOpening } from '../kannada-style';

describe('south indian name dictionary', () => {
  it('loads reference names without acting as a whitelist gate', () => {
    assert.ok(dictionarySize() >= 100);
    assert.ok(lookupName('Manjunath'));
    assert.equal(lookupName('Harshitha'), null);
  });
});

describe('resolveCustomerIdentity', () => {
  it('maps known male name to Mr. and spoken ಸರ್', () => {
    const id = resolveCustomerIdentity({ rawName: 'Manjunath', source: 'user_spoken' });
    assert.equal(id.customer_name_normalized, 'Manjunath');
    assert.equal(id.customer_gender, 'male');
    assert.ok(id.customer_gender_confidence >= 0.9);
    assert.equal(id.customer_salutation, 'Mr.');
    assert.equal(id.formal_display_name, 'Mr. Manjunath');
    assert.equal(id.spoken_address, 'Manjunath ಸರ್');
    assert.ok(id.in_name_dictionary);
    assert.ok(id.customer_name_pronunciation);
  });

  it('maps known female name to Ms. (not Mrs.) when marital status unknown', () => {
    const id = resolveCustomerIdentity({ rawName: 'Priya', source: 'user_spoken' });
    assert.equal(id.customer_gender, 'female');
    assert.equal(id.customer_salutation, 'Ms.');
    assert.equal(id.formal_display_name, 'Ms. Priya');
    assert.equal(id.spoken_address, 'Priya ಮ್ಯಾಡಮ್');
    assert.notEqual(id.customer_salutation, 'Mrs.');
  });

  it('uses Mrs. only when married evidence exists', () => {
    const id = resolveCustomerIdentity({
      rawName: 'Lakshmi',
      source: 'crm',
      maritalStatus: 'married',
    });
    assert.equal(id.customer_salutation, 'Mrs.');
    assert.equal(id.formal_display_name, 'Mrs. Lakshmi');
    assert.equal(id.spoken_address, 'Lakshmi ಮ್ಯಾಡಮ್');
  });

  it('preserves unknown names and avoids forced salutation', () => {
    const id = resolveCustomerIdentity({ rawName: 'Harshitha', source: 'user_spoken' });
    assert.equal(id.customer_name_normalized, 'Harshitha');
    assert.equal(id.in_name_dictionary, false);
    // No strong dictionary/linguistic hit required — stay cautious
    if (id.customer_gender_confidence < 0.9) {
      assert.equal(id.customer_salutation, null);
      assert.equal(id.formal_display_name, 'Harshitha');
      assert.equal(id.spoken_address, 'Harshitha');
    }
  });

  it('honors explicit Mr./Mrs. from speech over dictionary defaults', () => {
    const mrs = resolveCustomerIdentity({ rawName: 'Mrs. Priya', source: 'user_spoken' });
    assert.equal(mrs.customer_name_normalized, 'Priya');
    assert.equal(mrs.customer_salutation, 'Mrs.');
    assert.equal(mrs.customer_marital_status, 'married');
    assert.equal(mrs.customer_gender_evidence, 'explicit_customer');

    const mr = resolveCustomerIdentity({ rawName: 'I am Mr. Ramesh', source: 'user_spoken' });
    assert.equal(mr.customer_name_normalized, 'Ramesh');
    assert.equal(mr.customer_salutation, 'Mr.');
  });

  it('preserves professional titles over Mr./Mrs.', () => {
    const id = resolveCustomerIdentity({ rawName: 'Dr. Ravi', source: 'user_spoken' });
    assert.equal(id.customer_name_normalized, 'Ravi');
    assert.equal(id.customer_salutation, 'Dr.');
    assert.equal(id.formal_display_name, 'Dr. Ravi');
  });

  it('drops titles when customer prefers first name only', () => {
    const base = resolveCustomerIdentity({ rawName: 'Priya', source: 'user_spoken' });
    const corrected = applyCustomerCorrection(base, {
      preferFirstNameOnly: true,
    });
    assert.equal(corrected.prefer_first_name_only, true);
    assert.equal(corrected.customer_salutation, null);
    assert.equal(corrected.formal_display_name, 'Priya');
    assert.equal(corrected.spoken_address, 'Priya');
  });
});

describe('Kannada opening with identity', () => {
  it('uses the lead name naturally without forcing ಸರ್ in the greeting', () => {
    const male = buildOutboundKannadaOpening('Manjunath');
    assert.match(male, /ನಮಸ್ಕಾರ Manjunath/);
    assert.match(male, /ಭೂಮಿ ಮಾತಾಡ್ತಿದ್ದೀನಿ/);
    assert.match(male, /plot ನೋಡ್ತಿದ್ದೀರಾ/);

    const neutral = buildOutboundKannadaOpening(null);
    assert.match(neutral, /^ನಮಸ್ಕಾರ,/);
    assert.doesNotMatch(neutral, /ನಮಸ್ಕಾರ ಸರ್/);
  });

  it('uses ಮ್ಯಾಡಮ್ only via identity elsewhere — opening stays light', () => {
    const female = buildOutboundKannadaOpening('Priya');
    assert.match(female, /ನಮಸ್ಕಾರ Priya/);
    assert.doesNotMatch(female, /ಮ್ಯಾಡಮ್/);
  });

  it('uses the exact lead name even when not in the dictionary', () => {
    const opening = buildOutboundKannadaOpening('Prajwal');
    assert.match(opening, /ನಮಸ್ಕಾರ Prajwal/);
  });
});

describe('prompt rules', () => {
  it('includes addressing rules and identity context', () => {
    assert.match(CUSTOMER_NAME_AND_ADDRESSING_RULES, /Mrs\./);
    assert.match(CUSTOMER_NAME_AND_ADDRESSING_RULES, /ಮ್ಯಾಡಮ್/);
    const id = resolveCustomerIdentity({ rawName: 'Manjunath' });
    const ctx = formatIdentityContext(id);
    assert.match(ctx, /CANONICAL CUSTOMER IDENTITY/);
    assert.match(ctx, /Mr\. Manjunath/);
  });
});
