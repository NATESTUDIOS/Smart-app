// api/bot.js
// Vercel-style serverless function (Node.js).
//
// Env vars required:
// - GEMINI_API_KEY       (string)   -> Bearer key for the Gemini endpoint
// - GEMINI_API_URL       (string)   -> Full URL to send requests to (e.g. https://api.your-provider.com/v1/generate)
// Optionally adjust model name below.

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed - use POST' });
    }

    const body = req.body;
    // accept raw text or JSON { text: "..." }
    const inputText = typeof body === 'string' ? body : (body?.text ?? '');

    if (!inputText || inputText.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided in request body (send text or { text: "..." })' });
    }

    // 1) Simple heuristic: look for fenced code block with language e.g. ```html\n<...>\n```
    const fencedMatch = inputText.match(/```(\w+)?\s*([\s\S]*?)```/m);
    if (fencedMatch) {
      const lang = (fencedMatch[1] || '').trim() || detectLanguageFromCode(fencedMatch[2]);
      const code = fencedMatch[2].trim();
      const textOnly = inputText.replace(fencedMatch[0], '').trim();

      const imageurl = extractImageUrl(inputText);

      return res.status(200).json({
        Code: wrapAsParamStyle(code),
        Language: lang || 'unknown',
        Text: textOnly || null,
        ImageUrl: imageurl || null,
        source: 'heuristic'
      });
    }

    // 2) Heuristic: look for inline HTML (starts with <html> or contains tags) or single-line code-like content
    const htmlLike = inputText.match(/<([a-zA-Z]+)(\s|>)/);
    if (htmlLike) {
      const codeCandidate = extractHtmlSnippet(inputText) || inputText;
      const imageurl = extractImageUrl(inputText);

      return res.status(200).json({
        Code: wrapAsParamStyle(codeCandidate.trim()),
        Language: 'html',
        Text: removeSnippetFromText(inputText, codeCandidate),
        ImageUrl: imageurl || null,
        source: 'heuristic-html-detect'
      });
    }

    // 3) If heuristics didn't detect code, call Gemini to parse and extract the parameters.
    const geminiUrl = process.env.GEMINI_API_URL;
    const key = process.env.GEMINI_API_KEY;
    if (!geminiUrl || !key) {
      return res.status(500).json({
        error: 'Server misconfigured: GEMINI_API_URL and GEMINI_API_KEY must be set in environment.'
      });
    }

    // Prompt instructing the model to produce strict JSON with the exact parameter names:
    const prompt = `
You are an extractor. Input is arbitrary user text. Produce a single JSON object (no extra text).
Fields:
- Code: (string or null) if the input contains code, put the raw code content here.
  If present, wrap the code value exactly as the user requested parameter-style (example: Code: <!--hello world->) — but in the JSON value include the code itself (not "Code:" label).
- Language: (string or null) programming language, like "html", "javascript", "python".
- Text: (string or null) the remaining natural language text (non-code).
- ImageUrl: (string or null) a single image URL if input contains an image link or markdown image; otherwise null.

Return strictly JSON only. Example output:
{
  "Code": "<!--hello world->",
  "Language": "html",
  "Text": "some explanation",
  "ImageUrl": "https://.../image.jpg"
}

Input:
-----
${escapeForPrompt(inputText)}
-----
`;

    // Build the request payload - generic shape. Adjust to fit your provider if needed.
    const payload = {
      model: 'gemini-2.5-flash',
      input: prompt,
      // max tokens / temperature etc - optional
      // You can include provider-specific params here
      // temperature: 0,
      // max_output_tokens: 800
    };

    const r = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(payload),
      // allow a longer timeout on serverless if your provider supports it
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: 'Upstream model error', status: r.status, body: txt });
    }

    const result = await r.json();

    // The shape of the provider response varies.
    // We attempt to find the text output in a few likely places.
    const modelText = (
      result.output?.[0]?.content?.[0]?.text ?? // some providers
      result.candidates?.[0]?.output ??       // other shapes
      result.text ??                           // other
      JSON.stringify(result)
    );

    // Try to parse JSON out of the model output
    let parsed = null;
    try {
      parsed = JSON.parse(modelText);
    } catch (e) {
      // try to extract first JSON block from text
      const jsonBlock = modelText.match(/\{[\s\S]*\}/);
      if (jsonBlock) {
        try { parsed = JSON.parse(jsonBlock[0]); } catch (ee) { parsed = null; }
      }
    }

    if (!parsed) {
      // fallback: return raw model text so the caller can inspect
      return res.status(200).json({
        Code: null,
        Language: null,
        Text: inputText,
        ImageUrl: extractImageUrl(inputText) || null,
        source: 'model-raw',
        model_output: modelText
      });
    }

    // Ensure fields exist
    const final = {
      Code: parsed.Code ?? null,
      Language: parsed.Language ?? null,
      Text: parsed.Text ?? null,
      ImageUrl: parsed.ImageUrl ?? null,
      source: 'model-parsed'
    };

    return res.status(200).json(final);
  } catch (err) {
    console.error('extract handler error', err);
    return res.status(500).json({ error: 'Internal server error', details: String(err) });
  }
}

/* ----------------- Helper functions ----------------- */

function escapeForPrompt(s) {
  return String(s).replace(/\`\`\`/g, '```'); // keep fences, but you can further sanitize if needed
}

function detectLanguageFromCode(code) {
  const c = code.trim();
  if (/^\s*</.test(c)) return 'html';
  if (c.includes('function') || c.includes('console.log') || c.includes('=>')) return 'javascript';
  if (c.includes('def ') || c.includes('import ') && c.includes('from')) return 'python';
  if (c.includes('#include') || /int main/.test(c)) return 'c/c++';
  return 'unknown';
}

function wrapAsParamStyle(code) {
  // The user asked for "Code: <!--hello world->" parameter-style in the example.
  // We'll return the code wrapped in an HTML-comment-like style if it's HTML, else just return code.
  const trimmed = code ?? '';
  // If code already looks like it's in <!-- ... --> or other wrapper, return as-is
  if (/^<!--[\s\S]*-->$/.test(trimmed) || trimmed.length === 0) return trimmed;
  // If it looks like HTML, wrap in <!-- ... -->
  if (/^\s*</.test(trimmed)) {
    // sanitize closing for the example style (user used <!--hello world-> not strictly valid). We'll use valid HTML comment:
    return `<!--\n${trimmed}\n-->`;
  }
  // otherwise just return raw code string
  return trimmed;
}

function extractImageUrl(text) {
  if (!text) return null;
  // match markdown image ![alt](url) or plain url ending with image extensions
  const md = text.match(/![^]*\](https?:\/\/[^\s)]+)/i);
  if (md) return md[1];
  const plain = text.match(/(https?:\/\/[^\s]+(?:png|jpg|jpeg|gif|webp|svg))/i);
  if (plain) return plain[1];
  return null;
}

function extractHtmlSnippet(text) {
  // crude: extract first <...>...</...> block or from first '<' to last '>'
  const match = text.match(/<(\w+)[\s\S]*<\/\1>/i);
  if (match) return match[0];
  // fallback to chunk from first < to last >
  const start = text.indexOf('<');
  const end = text.lastIndexOf('>');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function removeSnippetFromText(full, snippet) {
  if (!snippet) return full.trim();
  return full.replace(snippet, '').trim();
}