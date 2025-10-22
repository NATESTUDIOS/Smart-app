import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { text } = req.body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Text (non-empty string) is required" });
  }

  try {
    // Initialize Gemini client
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });

    // Improved reasoning prompt
    const prompt = `
You are an intelligent AI extraction and generation engine.

You will receive a user input that may:
- Contain code,
- Contain text,
- Include image URLs,
- Or be a prompt asking you to *generate* something (like "build a website" or "create a scraping tool").

Your job:
1. **Understand intent**: determine whether to extract or generate.
2. **If generating**, create high-quality and complete code relevant to the request (use HTML/CSS/JS/Python/etc.).
3. **Always respond in JSON ONLY** with this schema:

{
  "Code": string | null,         // The extracted or generated code
  "Language": string | null,     // Language name (html, js, python, etc.)
  "Text": string | null,         // Pure text explanation, if any
  "ImageUrl": string | null      // Image URL if mentioned or generated
}

Rules:
- If code exists, wrap it like this: Code: <!--your code here->
- If input is a creation request, actually generate the code intelligently.
- If code or text are mixed, separate them clearly.
- Be concise but complete in code generation.
- Use null instead of empty strings.

Input:
${text}
`;

    // Generate output
    const result = await model.generateContent(prompt);
    const output = result?.response?.text?.() || "";

    // Try parsing structured JSON
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      // Fallback: interpret as plain text
      parsed = { Text: output };
    }

    // Secondary heuristics for missed code or image
    if (!parsed.Code && /```/.test(text)) {
      const match = text.match(/```(\w+)?\s*([\s\S]*?)```/m);
      if (match) {
        parsed.Code = `<!--${match[2].trim()}->`;
        parsed.Language = match[1] || "unknown";
      }
    }

    if (!parsed.ImageUrl) {
      const urlMatch = text.match(
        /(https?:\/\/[^\s]+(?:png|jpg|jpeg|gif|webp|svg))/i
      );
      if (urlMatch) parsed.ImageUrl = urlMatch[1];
    }

    // Final structured response
    res.status(200).json({
      success: true,
      response: {
        Code: parsed.Code || null,
        Language: parsed.Language || null,
        Text: parsed.Text || text,
        ImageUrl: parsed.ImageUrl || null,
      },
    });
  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: err.message,
    });
  }
}