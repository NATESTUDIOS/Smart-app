// api/extract.js
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

    // Prompt to structure response clearly
    const prompt = `
Analyze the given input text. Return JSON with these fields:
{
  "Code": string or null,        // Extract code if any, else null
  "Language": string or null,    // Detected code language (html, js, etc.)
  "Text": string or null,        // Remaining plain text without code
  "ImageUrl": string or null     // Image URL if included
}

If code exists, wrap it in the parameter style like this:
Code: <!--hello world->

Input:
${text}
`;

    // Generate output from Gemini
    const result = await model.generateContent(prompt);
    const output = result?.response?.text?.() || "";

    // Try parsing JSON output
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = { Text: output };
    }

    // Fallback heuristics if needed
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}