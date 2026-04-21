import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/drive/files", async (req, res) => {
  const { access_token } = req.body;

  const googleRes = await fetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  );

  const data = await googleRes.json();

  res.json({ files: data.files || [] });
});

app.listen(5000, () => console.log("Server running on 5000"));