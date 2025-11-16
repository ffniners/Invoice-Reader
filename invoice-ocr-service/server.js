const express = require("express");
const vision = require("@google-cloud/vision");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn(
    "[LLM] OPENAI_API_KEY not set. Requests to /analyze-invoice will fail until the key is provided."
  );
}

const app = express();
const visionClient = new vision.ImageAnnotatorClient();

app.use(express.json({ limit: "15mb" }));

app.post("/analyze-invoice", async (req, res) => {
  const { fileName, fileType, fileContentBase64 } = req.body || {};
  console.log(
    `[OCR] Received analyze request for ${fileName || "unknown file"} (${fileType || "unknown type"})`
  );

  if (!fileContentBase64) {
    return res.status(400).json({ error: "fileContentBase64 is required" });
  }

  try {
    // Step 1: Decode file content for Vision OCR
    const fileBuffer = Buffer.from(fileContentBase64, "base64");

    // Step 2: Extract text using Google Cloud Vision
    const fullText = await extractTextWithVision(fileBuffer);

    // Step 3: Hand OCR text to the LLM for semantic parsing
    const llmRaw = await callOpenAiParser(fullText);

    // Step 4: Validate & normalize JSON to the InvoiceOcrResult schema
    const normalized = normalizeInvoiceJson(llmRaw);

    return res.status(200).json(normalized);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("[SERVICE] Failed to analyze invoice", error);
    return res.status(status).json({
      error: error.publicMessage || "Failed to analyze invoice",
      details: error.details || error.message
    });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Invoice OCR service listening on port ${PORT}`);
});

async function extractTextWithVision(fileBuffer) {
  try {
    const [result] = await visionClient.documentTextDetection({
      image: { content: fileBuffer }
    });

    const fullText = result?.fullTextAnnotation?.text || "";
    console.log(`[OCR] Extracted ${fullText.length} characters from Vision`);
    return fullText;
  } catch (error) {
    const err = new Error("Vision OCR error");
    err.statusCode = 500;
    err.publicMessage = "Vision OCR error";
    err.details = error.message;
    throw err;
  }
}

async function callOpenAiParser(fullText) {
  if (!OPENAI_API_KEY) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.statusCode = 500;
    err.publicMessage = "LLM parsing error";
    throw err;
  }

  const prompt = buildParserPrompt(fullText);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert financial document parser. You analyze invoices from many different companies, normalize them, and always return strictly valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error("LLM parsing error");
      err.statusCode = 500;
      err.publicMessage = "LLM parsing error";
      err.details = text;
      throw err;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error("Empty LLM response");
      err.statusCode = 500;
      err.publicMessage = "LLM parsing error";
      throw err;
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      const err = new Error("Invalid LLM JSON");
      err.statusCode = 500;
      err.publicMessage = "Invalid LLM JSON";
      err.details = parseError.message;
      throw err;
    }
  } catch (error) {
    if (error.publicMessage) {
      throw error;
    }
    const err = new Error("LLM parsing error");
    err.statusCode = 500;
    err.publicMessage = "LLM parsing error";
    err.details = error.message;
    throw err;
  }
}

function buildParserPrompt(fullText) {
  return `You are provided with raw OCR text from an invoice.\n\nOCR TEXT:\n"""\n${fullText}\n"""\n\nReturn ONLY valid JSON with this schema:\n{\n  "vendor": "string",\n  "invoiceNumber": "string",\n  "invoiceDate": "YYYY-MM-DD string or null",\n  "subtotal": number,\n  "tax": number,\n  "total": number,\n  "lineItems": [\n    {\n      "description": "string",\n      "quantity": number,\n      "unitPrice": number,\n      "lineTotal": number\n    }\n  ]\n}\n\nRules:\n- If a value is missing, set it to null (for strings/dates) or 0 (for numbers).\n- Always provide at least one line item; synthesize a summary item if none exist.\n- Do not add extra keys or commentary.`;
}

function normalizeInvoiceJson(raw) {
  const safeNumber = (value) => (Number.isFinite(value) ? value : 0);
  const safeString = (value) => (typeof value === "string" ? value : "");
  const safeDate = (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    // Basic YYYY-MM-DD guard; leave as-is if already formatted
    const isoMatch = value.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    return isoMatch ? value.trim() : null;
  };

  const lineItemsArray = Array.isArray(raw?.lineItems) ? raw.lineItems : [];
  const normalizedLineItems = lineItemsArray.length
    ? lineItemsArray.map((item, index) => ({
        description: safeString(item?.description) || `Line Item ${index + 1}`,
        quantity: safeNumber(Number(item?.quantity)),
        unitPrice: safeNumber(Number(item?.unitPrice)),
        lineTotal: safeNumber(Number(item?.lineTotal))
      }))
    : [
        {
          description: "See OCR details",
          quantity: 1,
          unitPrice: safeNumber(Number(raw?.total)),
          lineTotal: safeNumber(Number(raw?.total))
        }
      ];

  return {
    vendor: safeString(raw?.vendor),
    invoiceNumber: safeString(raw?.invoiceNumber),
    invoiceDate: safeDate(raw?.invoiceDate),
    subtotal: safeNumber(Number(raw?.subtotal)),
    tax: safeNumber(Number(raw?.tax)),
    total: safeNumber(Number(raw?.total)),
    lineItems: normalizedLineItems
  };
}
