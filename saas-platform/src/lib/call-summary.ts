import { LEAD_STATUS } from '@/lib/lead-status';

export type SummaryInput = {
  durationSec: number;
  transcriptCount: number;
  transcription: string;
  interested: boolean | null | undefined;
  customerName?: string;
};

function buildFallbackSummary(input: SummaryInput): string {
  const durationInfo = `Call: ${input.durationSec}s. AI Turns: ${input.transcriptCount}.`;
  let outcomeLine = 'Customer intent is not yet clear from the conversation.';
  if (input.interested === true) {
    outcomeLine = 'Customer is looking for a plot/site in Mysuru.';
  } else if (input.interested === false) {
    outcomeLine = 'Customer is not looking for a plot/site.';
  }

  const lines = input.transcription
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-6);
  const snippet = lines.length > 0 ? lines.join(' ') : 'No transcript captured.';
  return `${durationInfo}\n\n${outcomeLine} ${snippet}`;
}

export async function generateCallSummary(input: SummaryInput): Promise<string> {
  const durationInfo = `Call: ${input.durationSec}s. AI Turns: ${input.transcriptCount}.`;
  const groqApiKey = process.env.GROQ_API_KEY?.trim();

  if (!groqApiKey || !input.transcription.trim()) {
    return buildFallbackSummary(input);
  }

  try {
    const summaryPrompt = `
Summarize the following conversation between an AI Agent (Priya) and a Customer.

REQUIREMENTS:
- Professional and concise (2-3 sentences).
- State clearly whether the customer is looking for a plot/site or not.
- Highlight the key outcome.
- INCLUDE the specific property name only if the customer showed interest or booked a visit.
- If the customer DID NOT confirm interest in a specific property, DO NOT mention any property names.

CONVERSATION:
${input.transcription}

SUMMARY:
`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a professional real estate assistant specializing in summarizing calls.',
          },
          { role: 'user', content: summaryPrompt },
        ],
        temperature: 0.5,
        max_tokens: 500,
      }),
    });

    const groqData: { choices?: { message?: { content?: string } }[] } = await groqResponse.json();
    const aiSummary = groqData.choices?.[0]?.message?.content?.trim();
    if (!aiSummary) return buildFallbackSummary(input);
    return `${durationInfo}\n\n${aiSummary}`;
  } catch {
    return buildFallbackSummary(input);
  }
}

/** User-facing label for plot-interest from lead flags. */
export function lookingStatusLabel(lead: {
  interested?: boolean | null;
  outcome_status?: string | null;
  outcomeStatus?: string | null;
}): 'Looking for Lead' | 'Not Looking for Lead' | 'Unknown' {
  const outcome = String(lead.outcome_status || lead.outcomeStatus || '').toLowerCase();
  if (outcome === LEAD_STATUS.NOT_INTERESTED || lead.interested === false) {
    return 'Not Looking for Lead';
  }
  if (
    outcome === LEAD_STATUS.INTERESTED ||
    outcome === LEAD_STATUS.FOLLOW_UP ||
    outcome === LEAD_STATUS.VISIT_SCHEDULED ||
    lead.interested === true
  ) {
    return 'Looking for Lead';
  }
  return 'Unknown';
}
