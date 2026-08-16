import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

export const twilioClient = twilio(accountSid, authToken);

export const fromPhone = process.env.TWILIO_PHONE_NUMBER;
export const fromPhoneFallback = process.env.TWILIO_PHONE_NUMBER_FALLBACK || fromPhone;

/**
 * Try a Twilio call with the primary FROM number, and automatically retry with
 * the fallback number (if different) on "source phone number not verified" errors.
 * This resolves Trial account geo-restrictions (e.g. verified Indian caller ID
 * works for self-test calls, purchased US Twilio number works post-upgrade).
 */
export async function createCallRetryable(options: Omit<Parameters<typeof twilioClient.calls.create>[0], 'from'> & { to: string }) {
  const primaries = [...new Set([fromPhone, fromPhoneFallback].filter(Boolean) as string[])];
  let lastErr: any;
  for (const from of primaries) {
    try {
      return await twilioClient.calls.create({ ...options, from });
    } catch (err: any) {
      console.error(`[Twilio] from=${from} failed: ${err.message}. ${primaries.length > 1 ? 'Retrying fallback...' : ''}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

