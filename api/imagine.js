import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ success: false, error: "Prompt is required" });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      { role: "user", parts: [{ text: prompt }] },
    ]);

    const imageBase64 = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!imageBase64) {
      return res.status(500).json({ success: false, error: "No image generated" });
    }

    const imageUrl = `data:image/png;base64,${imageBase64}`;

    res.status(200).json({
      success: true,
      imageUrl,
    });
  } catch (err) {
    console.error("Gemini image generation error:", err);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      details: err.message,
    });
  }
}