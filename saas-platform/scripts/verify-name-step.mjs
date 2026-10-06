/**
 * Reads the REAL emitted instructions for the call the caller described:
 *
 *   opening (intro + site question) -> caller says yes -> caller gives a name
 *
 * and prints what Priya is told to say at each step, so the sequence can be
 * checked without placing a call.
 *
 * Run: npx tsx scripts/verify-name-step.mjs
 */
import {
  getOutboundGreetingInstruction,
  OUTBOUND_NAME_QUESTION_NUDGE,
  buildOutboundProjectsNudge,
  buildOutboundNameDeclinedNudge,
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  extractCallerName,
  honorificForName,
  hasThanksClosing,
  looksLikeAnswerToSiteQuestion,
  PDF_SITE_QUESTION_KN,
  PDF_AREAS_LINE_KN,
  PDF_ACK_KN,
} from '../src/voice/kannada-script.ts';

// ---------------------------------------------------------------------------
// The dead-air bug. A caller answered the opening with something longer than a
// bare "yes", the name step bailed on the SHORT-affirmative test, and the
// interested classifier then deliberately said nothing.
// ---------------------------------------------------------------------------
console.log('=== caller replies after the site question → what she does ===');
const CALLER_REPLIES = [
  'ಹೌದು',
  'yes',
  'yes I am looking for a site',
  'yes i am looking for a site in mysuru',
  'Yes, I want a plot',
  'yeah I am interested',
  'ಹೌದು ನೋಡುತ್ತಿದ್ದೇನೆ',
  'ಹೌದು ಸೈಟ್ ಬೇಕು',
  'not interested',
  'ಇಲ್ಲ ಬೇಡ',
  'I am busy right now',
  'call me later',
  'uhm',
];
let silent = 0;
for (const said of CALLER_REPLIES) {
  const answers = looksLikeAnswerToSiteQuestion(said);
  const short = /^(?:ಹೌದು|yes|sari|ok|haan)[\s.!?]*$/i.test(said);
  const advances = answers || short;
  if (!advances) {
    // Not a yes: these have their OWN path (decline, busy, callback, repeat).
    silent++;
  }
  console.log(
    `  ${advances ? 'ASKS THE NAME' : 'own path (decline/busy/etc)'}${short && !answers ? '  [short yes]' : ''}  <- "${said}"`,
  );
}
const longerYeses = CALLER_REPLIES.filter((s) => !/^(?:ಹೌದು|yes|sari|ok|haan)[\s.!?]*$/i.test(s));
const longerYesesAnswered = longerYeses.filter(looksLikeAnswerToSiteQuestion);
console.log(
  `\n  longer-than-one-word replies: ${longerYesesAnswered.length}/${longerYeses.length} now advance the flow`,
);
for (const said of CALLER_REPLIES) {
  if (!/^(?:ಹೌದು|yes|sari|ok|haan)[\s.!?]*$/i.test(said) && !looksLikeAnswerToSiteQuestion(said)) {
    console.log(`  routed elsewhere (NOT silence): "${said}"`);
  }
}


console.log('=== THE PINNED CALL, as the model is given it ===');
for (const [label, prompt] of [
  ['FAST CONNECT (spoken at call start)', buildOutboundFastConnectInstruction('30 Sep 2026')],
  ['FULL SYSTEM (on reconnect)', buildOutboundSystemInstruction('30 Sep 2026')],
]) {
  const flat = prompt.replace(/\s+/g, ' ');
  const block = flat.slice(flat.indexOf('THE WHOLE CALL, IN FIVE STEPS'));
  console.log(`\n--- ${label} ---`);
  console.log(block.slice(0, block.indexOf('- There is NO sixth step')).trim());
  const pace = flat.slice(flat.indexOf('ONE PACE, EVERY TIME'));
  console.log('  pace rule:', pace.slice(0, pace.indexOf('- Do NOT "find the words"')).trim());
  const gone = [
    'Vary your rhythm',
    'Never deliver every sentence at the same speed',
    'It is fine to sound like you are finding the words',
    'Match the caller',
    'soften and slow down',
    'phrase it FRESH and cheerful every call',
    'fresh phrasing every call',
    'Say each step in your own natural words',
  ];
  let ok = true;
  for (const goneText of gone) {
    if (flat.includes(goneText)) {
      console.log(`  FAIL: still present -> "${goneText}"`);
      ok = false;
      process.exitCode = 1;
    }
  }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} every cause of "slow once fast" and re-wording is gone`);
}

const line = (t) => String(t).replace(/\s+/g, ' ').trim();

console.log('=== STEP 1 — what she says on answer ===');
console.log(getOutboundGreetingInstruction('kn').split('\n').filter((l) => l.includes('"')).join('\n'));
console.log('site question asked here? ', getOutboundGreetingInstruction('kn').includes(PDF_SITE_QUESTION_KN));

console.log('\n=== STEP 1B — caller says "yes": the name nudge ===');
console.log(line(OUTBOUND_NAME_QUESTION_NUDGE));
console.log('re-asks the site question? ', OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_SITE_QUESTION_KN));

for (const said of ['Ramesh', 'ರಮೇಶ್', 'ನಾನು ರಮೇಶ್', 'ಲಕ್ಷ್ಮಿ']) {
  const name = extractCallerName(said);
  const hon = honorificForName(name);
  console.log(`\n=== STEP 1C — caller said "${said}" → name=${JSON.stringify(name)} ${hon} ===`);
  if (!name) {
    console.log('(no usable name — she still speaks the locations line)');
  }
  const nudge = buildOutboundProjectsNudge(name, hon);
  console.log('first beat, as instructed:');
  console.log('  ' + line(nudge.slice(nudge.indexOf('(1)'), nudge.indexOf('(2)'))));
  console.log('re-asks the site question? ', nudge.includes(PDF_SITE_QUESTION_KN));
  console.log(`acknowledgement is "${PDF_ACK_KN}":`, nudge.includes(PDF_ACK_KN));
  console.log('nudge still ASKS for a thank-you? ', /thank them/i.test(nudge));

  // THE BUG THIS GUARDS. The old nudge said "thank them in ONE short
  // acknowledgement", so Priya said "Thank you Ravi sir, we have sites in
  // Hunusuru…". hasThanksClosing() matches the English "thanks?", the engine
  // armed the hard mute, and the caller heard NOTHING after giving their name.
  const usedToSay = `Thank you ${name || ''} ${hon}, ${PDF_AREAS_LINE_KN}`;
  const saysNow = `${PDF_ACK_KN} ${name || ''} ${hon} ${PDF_AREAS_LINE_KN}`;
  console.log(`  caused the silence : "${usedToSay}"`);
  console.log('    hasThanksClosing ->', hasThanksClosing(usedToSay), '(true = hard mute, turn cut off)');
  console.log(`  says now          : "${saysNow}"`);
  console.log('    hasThanksClosing ->', hasThanksClosing(saysNow), '(must be false)');
  if (hasThanksClosing(saysNow)) {
    console.error('    FAIL: the name step can still end the call');
    process.exitCode = 1;
  }
}

console.log('\n=== the prompts must not invite extra words ===');
for (const [label, prompt] of [
  ['full', buildOutboundSystemInstruction('30 Sep 2026')],
  ['fast', buildOutboundFastConnectInstruction('30 Sep 2026')],
]) {
  const flat = prompt.replace(/\s+/g, ' ');
  const checks = {
    'fixed lines are word-for-word': /FIXED LINES are word-for-word/.test(flat),
    'exempt from the fresh-phrasing rule': /EXEMPT from the "say it in your own words/.test(flat),
    'never promises a later step': /NEVER promise to explain more later/.test(flat),
    'nothing around a fixed line': /On a fixed line there is NOTHING before it and NOTHING after it/.test(flat),
  };
  console.log(`  ${label}:`);
  for (const [k, v] of Object.entries(checks)) {
    console.log(`    ${v ? 'OK  ' : 'FAIL'} ${k}`);
    if (!v) process.exitCode = 1;
  }
}
