import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { text } = req.body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({
      success: false,
      error: "Text (non-empty string) is required",
    });
  }

  try {
    // Initialize Gemini client
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });

    // 🧩 Intelligent extraction + generation prompt
    const prompt = `
You are a precise AI engine for analyzing or generating technical content.
The user input may contain or request:
- Code (for any programming language)
- Text (explanation, message, or idea)
- Image URL(s)
- Or a creative request (like "build a scraper" or "create a portfolio site")

Your responsibilities:
1. **Understand the intent.**
   - If input includes code → Extract and describe it.
   - If input requests code (e.g. "build", "create", "generate") → Generate high-quality, complete code for that.
   - If input includes both → Separate clearly.
   - If input has image URLs → Extract them.

2. **Always return valid JSON only**, following exactly this structure:
{
  "Code": string | null,        // The actual code, wrapped like this: Code: <!--your code here->
  "Language": string | null,    // Language of the code (html, js, python, etc.)
  "Text": string | null,        // Human-readable description or explanation
  "ImageUrl": string | null     // Image URL if present or relevant
}

Guidelines:
- NEVER include markdown (like \`\`\`) in the output.
- NEVER include explanations outside JSON.
- Be concise but complete — functional and well-formatted code.
- If uncertain, infer the most likely code language.
- Use null for any missing field.

Now process this input carefully and respond ONLY with JSON:
---
${text}
---
`;

    // Generate response
    const result = await model.generateContent(prompt);
    const output = result?.response?.text?.() || "";

    // Attempt JSON parse
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (err) {
      console.warn("Gemini returned unstructured output. Attempting fallback parse...");
      parsed = { Text: output };
    }

    // 🛠️ Fallbacks — just in case Gemini skips something
    if (!parsed.Code && /```/.test(text)) {
      const match = text.match(/```(\w+)?\s*([\s\S]*?)```/m);
      if (match) {
        parsed.Code = `<!--${match[2].trim()}->`;
        parsed.Language = match[1] || "unknown";
      }
    }

    if (!parsed.ImageUrl) {
      const urlMatch = text.match(/(https?:\/\/[^\s]+(?:png|jpg|jpeg|gif|webp|svg))/i);
      if (urlMatch) parsed.ImageUrl = urlMatch[1];
    }

    // Final structured return
    res.status(200).json({
      success: true,
      response: {
        Code: parsed.Code || null,
        Language: parsed.Language || null,
        Text: parsed.Text || "Processed successfully.",
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