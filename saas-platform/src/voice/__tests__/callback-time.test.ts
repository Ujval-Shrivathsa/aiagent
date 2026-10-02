import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallbackTime,
  parseClockToMinutes,
  isWithinCallbackWindow,
  spokenTimeLabel,
  looksLikeCallbackTimeRequest,
  requestedMinutesOfDay,
  CALLBACK_WINDOW_LABEL,
} from '../callback-time';

// Fixed reference "now" so date arithmetic is deterministic.
const NOW = new Date(2026, 8, 30, 11, 0, 0); // 30 Sep 2026, 11:00 local

describe('callback-time window', () => {
  it('accepts times inside 10am–7pm inclusive', () => {
    for (const t of ['10:00', '12:30', '17:45', '18:59', '19:00']) {
      const r = parseCallbackTime('today', t, NOW);
      assert.equal(r.ok, true, `${t} should be accepted`);
    }
  });

  it('rejects times outside the window without clamping them', () => {
    for (const t of ['09:00', '09:59', '19:01', '20:00', '23:30', '00:00']) {
      const r = parseCallbackTime('today', t, NOW);
      assert.equal(r.ok, false, `${t} should be rejected`);
      assert.match(r.ok ? '' : r.reason, /outside 10am–7pm/);
    }
  });

  it('rejects malformed input instead of guessing', () => {
    assert.equal(parseCallbackTime('today', 'sevenish', NOW).ok, false);
    assert.equal(parseCallbackTime('today', '', NOW).ok, false);
    assert.equal(parseCallbackTime('today', '25:00', NOW).ok, false);
    assert.equal(parseCallbackTime('today', '10:75', NOW).ok, false);
    assert.equal(parseCallbackTime('next tuesday', '15:00', NOW).ok, false);
  });

  it('defaults to today and advances only for tomorrow', () => {
    const today = parseCallbackTime(undefined, '16:00', NOW);
    assert.equal(today.ok && today.day, 'today');
    assert.equal(today.ok && today.at.getTime(), new Date(2026, 8, 30, 16, 0).getTime());

    // NOW is the 30th, so "tomorrow" must roll into October, not become the 31st.
    const tmr = parseCallbackTime('tomorrow', '16:00', NOW);
    assert.equal(tmr.ok && tmr.day, 'tomorrow');
    assert.equal(tmr.ok && tmr.at.getMonth(), 9); // October
    assert.equal(tmr.ok && tmr.at.getDate(), 1);
  });

  it('isWithinCallbackWindow agrees with the parser', () => {
    assert.equal(isWithinCallbackWindow(new Date(2026, 8, 30, 10, 0)), true);
    assert.equal(isWithinCallbackWindow(new Date(2026, 8, 30, 19, 0)), true);
    assert.equal(isWithinCallbackWindow(new Date(2026, 8, 30, 9, 59)), false);
    assert.equal(isWithinCallbackWindow(new Date(2026, 8, 30, 19, 1)), false);
  });

  it('labels times the way Priya says them in Kannada', () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m);
    assert.equal(spokenTimeLabel(at(19, 0), 'today'), 'ಸಂಜೆ 7 ಗಂಟೆಗೆ');
    assert.equal(spokenTimeLabel(at(10, 0), 'today'), 'ಬೆಳಗ್ಗೆ 10 ಗಂಟೆಗೆ');
    assert.equal(spokenTimeLabel(at(13, 30), 'today'), 'ಸಂಜೆ 1 ಗಂಟೆ 30 ನಿಮಿಷಕ್ಕೆ');
    assert.equal(spokenTimeLabel(at(19, 0), 'tomorrow'), 'ನಾಳೆ ಸಂಜೆ 7 ಗಂಟೆಗೆ');
    assert.equal(spokenTimeLabel(at(0, 15)), 'ಬೆಳಗ್ಗೆ 12 ಗಂಟೆ 15 ನಿಮಿಷಕ್ಕೆ');
  });

  it('exposes the window label used in prompts', () => {
    assert.equal(CALLBACK_WINDOW_LABEL, '10am–7pm');
  });
});

describe('clock format tolerance', () => {
  // A flow test caught the model sending "7pm" where the tool description asked
  // for "19:00". A strict parser meant the promise was spoken out loud and then
  // silently dropped, so format tolerance is deliberate — range is not.
  const mins = (s: string) => {
    const r = parseClockToMinutes(s);
    return r.ok ? r.minutes : -1;
  };

  it('accepts every spelling a model actually sends', () => {
    assert.equal(mins('19:00'), 19 * 60);
    assert.equal(mins('7pm'), 19 * 60);
    assert.equal(mins('7 PM'), 19 * 60);
    assert.equal(mins('7:30pm'), 19 * 60 + 30);
    assert.equal(mins('7:30 pm'), 19 * 60 + 30);
    assert.equal(mins('7'), 19 * 60); // bare 1-7 reads as evening
    assert.equal(mins('11am'), 11 * 60);
    assert.equal(mins('12am'), 0); // midnight is 12am, not 12pm
    assert.equal(mins('12pm'), 12 * 60);
    assert.equal(mins('1900'), 19 * 60);
    assert.equal(mins('19.00'), 19 * 60);
  });

  it('still refuses nonsense', () => {
    assert.equal(mins('sevenish'), -1);
    assert.equal(mins(''), -1);
    assert.equal(mins('25:00'), -1);
    assert.equal(mins('13pm'), -1);
  });

  it('range is enforced after format tolerance', () => {
    // "9pm" parses fine but is outside the window — format tolerance must not
    // become range tolerance.
    const r = parseCallbackTime('today', '9pm', NOW);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /outside 10am–7pm/);
    const ok = parseCallbackTime('today', '7pm', NOW);
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.at.getHours(), 19);
  });
});

describe('callback-time request detection', () => {
  it('recognises an explicit callback request with a clock time', () => {
    assert.equal(looksLikeCallbackTimeRequest('call me at 7pm'), true);
    assert.equal(looksLikeCallbackTimeRequest('Call me at 7:30 pm'), true);
    assert.equal(looksLikeCallbackTimeRequest('please call at 6 in the evening'), true);
    assert.equal(looksLikeCallbackTimeRequest('ಸಂಜೆ 7 ಗಂಟೆಗೆ ಕರೆ ಮಾಡಿ'), true);
    assert.equal(looksLikeCallbackTimeRequest('ring me at 11am'), true);
  });

  it('ignores replies that are not about being called back', () => {
    assert.equal(looksLikeCallbackTimeRequest('yes'), false);
    assert.equal(looksLikeCallbackTimeRequest('ಹೌದು'), false);
    assert.equal(looksLikeCallbackTimeRequest('call later'), false); // no clock time
    assert.equal(looksLikeCallbackTimeRequest('7pm'), false); // no call/phone word
    assert.equal(looksLikeCallbackTimeRequest(''), false);
  });

  it('reads the requested hour so the guard can refuse out-of-window times', () => {
    assert.equal(requestedMinutesOfDay('call me at 7pm'), 19 * 60);
    assert.equal(requestedMinutesOfDay('call me at 7'), 19 * 60); // bare 7 = evening
    assert.equal(requestedMinutesOfDay('call me at 7:30am'), 7 * 60 + 30);
    assert.equal(requestedMinutesOfDay('call at 10am'), 10 * 60);
    assert.equal(requestedMinutesOfDay('call at 9am'), 9 * 60);
    assert.equal(requestedMinutesOfDay('call at 8pm'), 20 * 60);
    assert.equal(requestedMinutesOfDay('ಸಂಜೆ 7 ಗಂಟೆಗೆ'), 19 * 60);
    assert.equal(requestedMinutesOfDay('call me sometime'), null);
  });
});