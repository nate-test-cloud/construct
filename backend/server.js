import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/extract", async (req, res) => {
  console.log("🔥 /extract endpoint hit");

  const { text } = req.body;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer ",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemma-4-26b-a4b-it:free",
        messages: [
          {
            role: "user",
            content: `
Extract action items from the following meeting notes.

Return ONLY JSON:
[
  {
    "task": "...",
    "owner": "...",
    "deadline": "..."
  }
]

Notes:
${text}
            `,
          },
        ],
      }),
    });

    const data = await response.json();
    console.log("FULL AI RESPONSE:", data);

    const raw = data.choices?.[0]?.message?.content;

    let parsed = [];

    try {
      const match = raw.match(/\[.*\]/s);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch {
      console.log("Parsing failed");
    }

    res.json({ tasks: parsed });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI failed" });
  }
});

app.listen(5000, () => console.log("AI server running on 5000"));
