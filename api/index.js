import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import multer from "multer";

const require = createRequire(import.meta.url);
const PDFParser = require("pdf2json");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static("public"));

// Multer configuration for PDF uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// PDF upload and extraction endpoint
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    // Parse PDF using pdf2json
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", (errData) => {
      res.status(400).json({ error: "Invalid PDF file: " + errData.parserError });
    });

    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        // Extract text from all pages
        let pdfText = "";
        let pageCount = 0;

        // Check if pages exist
        if (pdfData && pdfData.Pages && Array.isArray(pdfData.Pages)) {
          pageCount = pdfData.Pages.length;
          
          pdfData.Pages.forEach((page, pageIndex) => {
            if (page.Texts && Array.isArray(page.Texts)) {
              const pageText = page.Texts
                .map(textItem => {
                  try {
                    return decodeURIComponent(textItem.R[0]?.T || "");
                  } catch (e) {
                    return textItem.R[0]?.T || "";
                  }
                })
                .join(" ");
              pdfText += pageText + "\n";
            }
          });
        } else {
          return res.status(400).json({ error: "PDF structure not recognized" });
        }

        const cleanText = pdfText.trim();
        
        if (!cleanText || cleanText.length === 0) {
          return res.status(400).json({ error: "PDF contains no readable text" });
        }
        res.json({
          success: true,
          filename: req.file.originalname,
          text: cleanText,
          pageCount: pageCount
        });
      } catch (err) {
        res.status(500).json({ error: "Failed to extract text: " + err.message });
      }
    });

    // Parse the PDF buffer
    pdfParser.parseBuffer(req.file.buffer);
  } catch (err) {
    res.status(500).json({ error: "Failed to process PDF: " + err.message });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    // πάρε μόνο τα user/assistant messages (η Claude δεν θέλει system μέσα στο array)
    const conversation = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
      }));

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 2048,
      messages: conversation,
      system: "You are a helpful assistant."
    });

    const reply = response.content[0].text;

    res.json({
      choices: [
        { message: { content: reply } }
      ]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Generate a short representative title for a conversation
app.post("/generate-title", async (req, res) => {
  try {
    const { messages } = req.body;

    // Keep same filtering: remove system messages for Claude
    const conversation = (messages || [])
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    // Ask the model to produce a single short title (no extra text)
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 50,
      messages: conversation,
      system: "You are a concise assistant that converts a conversation into a short descriptive title (max 8 words). Reply with only the title, no additional explanation, no punctuation at the end."
    });

    const title = (response?.content?.[0]?.text || "").trim();
    if (!title) {
      return res.status(500).json({ error: "Model did not return a title" });
    }

    res.json({ title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 8080, () => {
    console.log('Server running on port 8080');
  });
}

export default app;