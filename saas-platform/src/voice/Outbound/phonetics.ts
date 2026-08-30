/**
 * Outbound location pronunciation — PDF script text keeps standard spelling;
 * pronunciation is applied when speaking aloud.
 */

export type LocationPhonetic = {
  written: string[];
  ipa: string;
  spoken: string;
};

export const OUTBOUND_LOCATION_PHONETICS: LocationPhonetic[] = [
  {
    written: ['T. Narasipura Road', 'T Narasipura Road', 'T. Narasipura', 'T Narasipura', 'Narasipura'],
    ipa: '/tiː ˌnʌrəsiˈpʊrə/',
    spoken: 'tee nuh-ra-see-poo-ra',
  },
  {
    written: ['Srirampura Ring Road', 'Srirampura Junction', 'Srirampura'],
    ipa: '/ʃriːˈrɑːmpʊrə/',
    spoken: 'shree-raam-poo-ra',
  },
  {
    written: ['Hunsur Road', 'Hunsur'],
    ipa: '/ˌhʊnəˈsuːru/',
    spoken: 'Hun-sooru',
  },
  {
    written: ['Kushalnagar'],
    ipa: '/kʊʃəlˈnɑːɡər/',
    spoken: 'koo-shal-naa-gar',
  },
  {
    written: ['Ilavala'],
    ipa: '/iːləˈvɑːlə/',
    spoken: 'ee-la-va-la',
  },
  {
    written: ['Mysuru'],
    ipa: '/maɪˈsuːruː/',
    spoken: 'my-soo-roo',
  },
  {
    written: ['Mysore'],
    ipa: '/maɪˈsɔːr/',
    spoken: 'my-sore',
  },
  {
    written: ['Yachenahalli'],
    ipa: '/jətʃeˈnɑːhəli/',
    spoken: 'ya-che-na-hal-li',
  },
  {
    written: ['Yelwala'],
    ipa: '/jelˈvɑːlə/',
    spoken: 'yel-wa-la',
  },
  {
    written: ['Varakodu'],
    ipa: '/vʌrəˈkoːdu/',
    spoken: 'va-ra-ko-du',
  },
  {
    written: ['Nanjangud'],
    ipa: '/ˌnʌndʒʌnˈɡʊd/',
    spoken: 'nan-jan-good',
  },
  {
    written: ['Bannur'],
    ipa: '/bʌˈnʊər/',
    spoken: 'bun-noor',
  },
  {
    written: ['Chamalapura'],
    ipa: '/tʃʌməˈlɑːpʊrə/',
    spoken: 'cha-ma-la-poo-ra',
  },
];

export function buildPronunciationGuide(): Record<string, string> {
  const guide: Record<string, string> = {};
  for (const entry of OUTBOUND_LOCATION_PHONETICS) {
    for (const name of entry.written) {
      guide[name] = `${entry.ipa} → say "${entry.spoken}"`;
    }
  }
  return guide;
}

export const PRONUNCIATION_GUIDE = buildPronunciationGuide();

export function buildOutboundPhoneticRules(): string {
  const spoken = [
    ['Hunsur', 'Hun-sooru', 'PDF: native Karnataka/Mysuru pronunciation — never "Hun-sur"'],
    ['T. Narasipura', 'tee nuh-ra-see-poo-ra', '/tiː ˌnʌrəsiˈpʊrə/'],
    ['Srirampura', 'shree-raam-poo-ra', '/ʃriːˈrɑːmpʊrə/'],
    ['Mysuru', 'my-soo-roo', '/maɪˈsuːruː/'],
    ['Ilavala', 'ee-la-va-la', '/iːləˈvɑːlə/'],
    ['Kushalnagar', 'koo-shal-naa-gar', '/kʊʃəlˈnɑːɡər/'],
  ] as const;
  const rows = spoken.map(([name, say, ref]) => `- ${name}: ${ref} → say "${say}"`);
  return `LOCATION PRONUNCIATION (when speaking aloud — scripts keep normal spelling):
Use the pronunciation below when you SAY place names.

${rows.join('\n')}

When the script says "Hunsur Road", pronounce Hunsur as "Hun-sooru" (ಹುಣೂರು).
When the script says "T. Narasipura Road", pronounce T. Narasipura naturally as "tee nuh-ra-see-poo-ra".
When the script says "Srirampura", pronounce it "shree-raam-poo-ra".
Never say "Hun-sur" or "Tina-sipur".`;
}
