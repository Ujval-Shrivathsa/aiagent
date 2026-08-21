/**
 * South Indian name reference dataset — pronunciation + common gender association.
 * NOT a whitelist: unknown names are always accepted.
 */
import namesData from './south-indian-names.json';
import type { Gender } from './types';

export interface NameDictionaryEntry {
  name: string;
  gender: 'male' | 'female';
  ipa: string | null;
}

type NamesFile = {
  version: number;
  source: string;
  names: NameDictionaryEntry[];
};

const data = namesData as NamesFile;

function normalizeKey(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z\u0c80-\u0cff\s'-]/gi, '')
    .replace(/\s+/g, ' ');
}

const byKey = new Map<string, NameDictionaryEntry>();
for (const entry of data.names) {
  if (!entry?.name) continue;
  byKey.set(normalizeKey(entry.name), entry);
}

export function lookupName(name: string | null | undefined): NameDictionaryEntry | null {
  if (!name?.trim()) return null;
  return byKey.get(normalizeKey(name)) ?? null;
}

export function dictionaryGender(name: string | null | undefined): Gender | null {
  const hit = lookupName(name);
  return hit ? hit.gender : null;
}

export function dictionaryPronunciation(name: string | null | undefined): string | null {
  return lookupName(name)?.ipa ?? null;
}

export function dictionarySize(): number {
  return byKey.size;
}

export { normalizeKey as normalizeNameKey };
