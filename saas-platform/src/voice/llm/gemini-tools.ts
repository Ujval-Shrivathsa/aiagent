import { Type } from '@google/genai';
import { SARVAM_TOOLS } from '../sarvam/tools';

/** Same tool semantics as Sarvam / Gemini Live — for hybrid chat completions. */
export const GEMINI_VOICE_TOOLS = [
  {
    name: 'endCall',
    description: SARVAM_TOOLS[0].function.description,
    parameters: { type: Type.OBJECT, properties: {}, required: [] as string[] },
  },
  {
    name: 'bookAppointment',
    description: SARVAM_TOOLS[1].function.description,
    parameters: {
      type: Type.OBJECT,
      properties: {
        dateTime: {
          type: Type.STRING,
          description:
            'ISO 8601 date and time (e.g. 2024-04-16T10:30:00). Must be between 10:00 and 17:30 local time.',
        },
      },
      required: ['dateTime'],
    },
  },
  {
    name: 'setFollowUp',
    description: SARVAM_TOOLS[2].function.description,
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Reason for the follow-up (e.g. 'not sure of date')." },
      },
      required: ['reason'],
    },
  },
  {
    name: 'setName',
    description: SARVAM_TOOLS[3].function.description,
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Customer name as spoken.' },
        title: { type: Type.STRING, description: 'Optional title: Mr., Mrs., Ms., Dr., Prof., Er., or CA.' },
        maritalStatus: { type: Type.STRING, description: 'Optional: married | unmarried | unknown.' },
        preferFirstNameOnly: {
          type: Type.BOOLEAN,
          description: 'True when they ask to be addressed by first name only.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'notInterested',
    description: SARVAM_TOOLS[4].function.description,
    parameters: { type: Type.OBJECT, properties: {}, required: [] as string[] },
  },
];
