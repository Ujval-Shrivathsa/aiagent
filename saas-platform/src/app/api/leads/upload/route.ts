import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const campaignId = formData.get('campaignId') as string;

    if (!file || !campaignId) {
      return NextResponse.json({ error: 'File and campaignId required' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    // Use raw: false to get formatted strings, AND cellDates: false, plus cellNF fallback to
    // prevent Excel "General" format from turning phone numbers into 9.19E+11 scientific notation
    const data: any[] = XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    if (data.length < 1) {
      return NextResponse.json({ error: 'Spreadsheet is empty.' }, { status: 400 });
    }

    // --- HEURISTIC HEADER SEARCH ---
    let nameIndex = -1;
    let phoneIndex = -1;
    let headerRowIndex = -1;

    // Scan for keywords first (limit to top 10 rows for efficiency)
    for (let i = 0; i < Math.min(data.length, 10); i++) {
        if (!Array.isArray(data[i])) continue;
        const row = data[i].map((c: any) => c?.toString().toLowerCase().trim() || "");
        const nIdx = row.findIndex((h: string) => h.includes('name') || h.includes('customer') || h.includes('lead'));
        const pIdx = row.findIndex((h: string) => h.includes('phone') || h.includes('contact') || h.includes('mobile') || h.includes('number'));
        
        if (pIdx !== -1) {
            phoneIndex = pIdx;
            nameIndex = nIdx;
            headerRowIndex = i;
            console.log(`[Import] Found headers at row ${i}: Phone at col ${pIdx}, Name index: ${nIdx}`);
            if (nIdx !== -1) break;
        }
    }

    // Heuristic fallback: if no header found, look for a row that has a 10+ digit number
    if (phoneIndex === -1) {
        console.log("[Import] No explicit headers found. Attempting heuristic scan...");
        for (let i = 0; i < Math.min(data.length, 10); i++) {
             if (!Array.isArray(data[i])) continue;
             const pIdx = data[i].findIndex((c: any) => {
                 const str = c?.toString().replace(/\D/g, '') || "";
                 return str.length >= 10;
             });
             if (pIdx !== -1) {
                 phoneIndex = pIdx;
                 headerRowIndex = i - 1; // Assume this row or the one above is the start
                 // Guess name is the first non-numeric column found in the same row
                 nameIndex = data[i].findIndex((c: any, idx: number) => 
                    idx !== pIdx && c?.toString().trim().length > 1 && isNaN(Number(c))
                 );
                 console.log(`[Import] Heuristic match: Phone at col ${pIdx}, suggested Name at col ${nameIndex}`);
                 break;
             }
        }
    }

    if (phoneIndex === -1) {
       console.error("[Import Error] No phone numbers or headers found.", data[0]);
       return NextResponse.json({ error: 'Could not find a phone number column. Please ensure your contact details are in a column named "Phone" or "Contact Details".' }, { status: 400 });
    }

    // --- PREREQUISITE CHECK (Auto-Recovery) with Retry ---
    let targetUser;
    let campaign;
    let leadsToCreate: any[] = [];
    let retries = 5;

    while (retries > 0) {
      try {
        targetUser = await prisma.user.findFirst();
        if (!targetUser) {
          console.log("[Import] No users found. Creating default 'team@alliancesquare.in'");
          targetUser = await prisma.user.create({
            data: {
              email: "team@alliancesquare.in",
              password: "default-password",
            }
          });
        }

        // Find or Create Campaign
        campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
        if (!campaign) {
          console.log(`[Import] Campaign ${campaignId} missing. Auto-creating...`);
          campaign = await prisma.campaign.create({
            data: {
              id: campaignId,
              name: "Main Campaign",
              userId: targetUser.id
            }
          });
        }

        // --- DEDUPLICATION ---
        const existingLeads = await prisma.lead.findMany({
          where: { campaignId },
          select: { phone: true }
        });
        const existingPhones = new Set(existingLeads.map(l => l.phone));

        // --- DATA MAPPING ---
        leadsToCreate = data.slice(headerRowIndex + 1)
          .map(row => {
            if (!Array.isArray(row)) return null;
            const rawPhone = row[phoneIndex];
            const rawName = nameIndex !== -1 ? row[nameIndex] : null;

            if (!rawPhone) return null;

            // Fallback for missing names
            const name = (rawName || "").toString().trim();
            let rawPhoneStr = rawPhone?.toString() || "";

            // [Excel Fix #1] Handle scientific notation (e.g. 9.1897E+11 -> real digits)
            // xlsx raw:false + format cells usually prevents this, but we harden just in case
            if (/\d+\.?\d*[eE][+-]?\d+/.test(rawPhoneStr.trim())) {
              try {
                const asFloat = parseFloat(rawPhoneStr);
                if (!isNaN(asFloat) && isFinite(asFloat)) {
                  rawPhoneStr = BigInt(Math.round(asFloat)).toString();
                }
              } catch { /* keep raw */ }
            }

            // [Excel Fix #2] Handle Excel numeric stored as "918971901128.00" / "918971901128.0"
            // Strip trailing dot-zero fraction ONLY if the fractional part is zero (legitimate
            // phone numbers never end in ".xx")
            rawPhoneStr = rawPhoneStr.replace(/\.0+$/g, '');

            let phone = rawPhoneStr.replace(/\D/g, ''); // Digits only

            // [India Fix] Handle double country code (e.g. "91918971901128" → "918971901128")
            if (phone.length === 12 && phone.startsWith('91')) {
              // Looks like phone already prefixed with 91 but missing '+', so strip and re-add cleanly
              phone = phone.slice(2);
            }
            // Also handle edge case where user entered +91918971901128 -> digits -> 12 chars above catches
            // or if 14 chars starting 9191 -> same logic
            if (phone.length === 14 && phone.startsWith('9191')) {
              phone = phone.slice(2);
            }

            // Normalize to E.164
            if (phone.length === 10) {
              // Assume India (Alliance Square = Mysore based)
              phone = `+91${phone}`;
            } else if (phone.length >= 11 && !phone.startsWith('+')) {
              phone = `+${phone}`;
            } else if (phone && !phone.startsWith('+')) {
              phone = `+${phone}`;
            }

            if (existingPhones.has(phone)) return null;

            return {
              name,
              phone,
              campaignId,
            };
          })
          .filter(Boolean) as any[];

        console.log(`[Import] Found ${leadsToCreate.length} new unique leads.`);

        if (leadsToCreate.length === 0) {
          const message = existingPhones.size > 0
            ? "All leads in this file already exist in this campaign."
            : "No valid contacts found in the spreadsheet.";
          return NextResponse.json({ success: true, count: 0, message });
        }

        const created = await prisma.lead.createMany({
          data: leadsToCreate
        });

        return NextResponse.json({ success: true, count: created.count });
      } catch (e: any) {
        if (e.code === 'P1008' || e.code === 'P2010' || e.message?.includes('busy') || e.message?.includes('locked')) {
          retries--;
          if (retries === 0) throw e;
          console.log(`[Import] DB busy, retrying... (${retries} left)`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw e;
      }
    }
  } catch (error: any) {
    console.error("Upload Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
