/** OpenAI-style tools for Sarvam chat completions (same semantics as Gemini Live tools). */

export const SARVAM_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'endCall',
      description:
        "End the call ONLY when the customer has CLEARLY said they want to finish — e.g. bye, goodbye, thank you for your time, thanks that's all, I'm done, that's all I needed, you can end the call, or an equivalent clear goodbye in any language. Also allowed after completing a busy/callback-later script the customer requested, or after they clearly declined interest. NEVER call this because of elapsed time, silence, pauses, short replies (okay/hmm), topic changes, or incomplete answers.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bookAppointment',
      description:
        'Book a site-visit appointment. Only use this if they agree on a specific date and time within the preferred site-visit window of 10:00 AM to 5:30 PM.',
      parameters: {
        type: 'object',
        properties: {
          dateTime: {
            type: 'string',
            description:
              'ISO 8601 date and time (e.g. 2024-04-16T10:30:00). Must be between 10:00 and 17:30 local time.',
          },
        },
        required: ['dateTime'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'setFollowUp',
      description:
        'Mark the customer for a follow-up if they are interested but unsure of when they can visit or need more time to decide.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: "Reason for the follow-up (e.g. 'not sure of date').",
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'setName',
      description:
        "Update the customer's name and optional form of address once they provide it or correct it. Pass the exact name they said.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Customer name as spoken.' },
          title: {
            type: 'string',
            description: 'Optional title: Mr., Mrs., Ms., Dr., Prof., Er., or CA.',
          },
          maritalStatus: {
            type: 'string',
            description: 'Optional: married | unmarried | unknown.',
          },
          preferFirstNameOnly: {
            type: 'boolean',
            description: 'True when they ask to be addressed by first name only.',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'notInterested',
      description:
        'Call when the customer explicitly and clearly says they are not interested. Do not call just because the call is ending without a booking.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
