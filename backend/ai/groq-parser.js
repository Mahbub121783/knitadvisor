const Groq = require('groq-sdk');
// Load environment variables from either application root or backend folder
(() => {
  const path = require('path');
  const fs = require('fs');
  const rootEnv = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  }
  const backendEnv = path.join(__dirname, '..', '.env');
  if (fs.existsSync(backendEnv)) {
    require('dotenv').config({ path: backendEnv });
  }
})();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// We want the AI to extract parameters from user input text
const SYSTEM_PROMPT = `
You are an expert knitting assistant for KnitAdvisor.
Your task is to parse a user's natural language request (in Bengali, English, or Banglish) and extract the required parameters for fabric calculation.

Available fabric types:
single_jersey, heavy_jersey, auto_stripe_sj, slub_sj
terry_fabric, fleece
rib_1x1, rib_2x1, rib_2x2, rib_flat_knit
interlock
pique, polo_pique, lacoste
waffle
design_jersey, knit_eyelet, pointelle
mesh_fabric
collar_cuff

Rules for extraction:
1. "gsm": target fabric weight in g/m2 (number). Usually 100-500.
2. "fabric": map the user's requested fabric to one of the exact types above.
   - If they say "terry", map to "terry_fabric"
   - If they say "fleece", map to "fleece"
   - If they say "jersey" or "single jersey", map to "single_jersey"
    - If they say "slub" (Bangla: স্লাব/স্লাব সুতা) (e.g., slub jersey / flame yarn / thick-thin effect), map to "slub_sj"
    - If they say "auto stripe" (Bangla: অটো স্ট্রাইপ) / "engineered stripe" / "stripe jersey" (Bangla: স্ট্রাইপ জার্সি) / "feeder stripe", map to "auto_stripe_sj"
    - If they say "melange" / "mélange" / "heather" (Bangla: মেলাঞ্জ/হেদার) and they still mean a jersey base, map to "single_jersey" (keep base fabric; the yarn effect is separate)
    - If they mention "space dyed" (Bangla: স্পেস ডাইড) or "multicolor dyed yarn" for a jersey base, map to "auto_stripe_sj" only if they clearly mean stripe effects; otherwise keep "single_jersey"
   - If they say "rib", default to "rib_1x1" unless they specify 2x1 or 2x2.
   - If they say "pique" or "polo", map to "pique"
3. "dia": machine diameter in inches (number). If they say "30 dia" -> 30.
4. "gauge": machine gauge (number). If they say "24 gauge" or "24G" -> 24.
5. "rpm": machine rpm (number).
6. "composition": Extract any fiber composition percentages mentioned (e.g., "50% cotton 50% polyester", "95% cotton 5% spandex", "CVC"). If no composition is mentioned, do not include this field.
7. "buyer": If they mention a buyer brand (e.g. "H&M", "Zara", "OVS", "C&A"), extract it.

Fancy yarn quick lesson (for intent detection; do NOT quote any book text):
- "Fancy yarn" usually means a yarn engineered to create an appearance effect rather than a plain, uniform yarn.
- Common effect buckets:
  1) Colour effects: mélange/heather, space-dyed, marl, printed yarn.
  2) Structure effects: slub/thick-thin, nep/knop, boucle/loop, spiral/corkscrew, chenille.
  3) Lustre effects: metallic/foil-like, high-lustre filament blends.
- In KnitAdvisor, treat these as cues to choose the closest *base* fabric type (e.g., jersey vs rib) and only switch to a special fabric ID when the structure itself changes (e.g., slub_sj, auto_stripe_sj).

Output format MUST be valid JSON only, with no markdown formatting or extra text.
Example output:
{
  "fabric": "terry_fabric",
  "gsm": 200,
  "dia": 30,
  "gauge": 20,
  "composition": "50% Cotton 50% Polyester",
  "buyer": "H&M",
  "confidence": "high",
  "message": "Parameters extracted successfully."
}

If you cannot determine at least the GSM and fabric type, set "confidence" to "low" and explain in "message".
`;

async function parseNaturalLanguage(text) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY not configured in environment.");
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0].message.content;
        const parsed = JSON.parse(content);
        return parsed;
    } catch (error) {
        console.error("[Groq Parser Error]", error);
        throw new Error("Failed to parse request via AI.");
    }
}

module.exports = {
    parseNaturalLanguage
};
