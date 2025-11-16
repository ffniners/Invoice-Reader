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
    const normalized = parseAndValidateInvoiceJson(llmRaw);

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

    return content;
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

function parseAndValidateInvoiceJson(rawJson) {
  // The LLM is instructed to return JSON, but we defensively parse and normalize it here
  // so Salesforce always receives a predictable InvoiceOcrResult payload.
  let parsed;
  if (typeof rawJson === "string") {
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      const err = new Error("Invalid JSON returned from LLM");
      err.statusCode = 500;
      err.publicMessage = "Invalid LLM JSON";
      err.details = error.message;
      throw err;
    }
  } else if (typeof rawJson === "object" && rawJson !== null) {
    parsed = rawJson;
  } else {
    const err = new Error("Invalid JSON returned from LLM");
    err.statusCode = 500;
    err.publicMessage = "Invalid LLM JSON";
    throw err;
  }

  const safeStringOrNull = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const safeNumberOrZero = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const invoice = {
    vendor: safeStringOrNull(parsed.vendor),
    invoiceNumber: safeStringOrNull(parsed.invoiceNumber),
    invoiceDate: safeStringOrNull(parsed.invoiceDate),
    subtotal: safeNumberOrZero(parsed.subtotal),
    tax: safeNumberOrZero(parsed.tax),
    total: safeNumberOrZero(parsed.total),
    lineItems: []
  };

  // Normalize line items so each entry has the expected structure.
  const rawLineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
  invoice.lineItems = rawLineItems.map((item) => ({
    description: safeStringOrNull(item?.description),
    quantity: safeNumberOrZero(item?.quantity),
    unitPrice: safeNumberOrZero(item?.unitPrice),
    lineTotal: safeNumberOrZero(item?.lineTotal)
  }));

  return invoice;
}
