const express = require("express");
const vision = require("@google-cloud/vision");

const PORT = process.env.PORT || 3000;
const app = express();
const client = new vision.ImageAnnotatorClient();

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
    const fileBuffer = Buffer.from(fileContentBase64, "base64");

    const [result] = await client.documentTextDetection({
      image: { content: fileBuffer }
    });

    const fullText =
      (result.fullTextAnnotation && result.fullTextAnnotation.text) || "";
    const parsed = parseInvoiceText(fullText);

    return res.json(parsed);
  } catch (error) {
    console.error("[OCR] Failed to analyze invoice", error);
    return res.status(500).json({ error: "Failed to analyze invoice" });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Invoice OCR service listening on port ${PORT}`);
});

function parseInvoiceText(fullText) {
  const normalizedText = (fullText || "").replace(/\r\n/g, "\n");
  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const vendor = lines[0] || "";
  const invoiceNumber = extractFirstMatch(
    /invoice\s*(number|no\.?)[^\w]?\s*([A-Za-z0-9-]+)/i,
    normalizedText,
    2
  );
  const invoiceDateRaw =
    extractFirstMatch(
      /invoice\s*date[^\d]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      normalizedText,
      1
    ) ||
    extractFirstMatch(
      /date[^\d]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      normalizedText,
      1
    );
  const invoiceDate = normalizeDate(invoiceDateRaw);

  const subtotal = parseCurrency(
    extractFirstMatch(/subtotal[^\d]*(\d+[\d.,]*)/i, normalizedText, 1)
  );
  const tax = parseCurrency(
    extractFirstMatch(/tax[^\d]*(\d+[\d.,]*)/i, normalizedText, 1)
  );
  const total = parseCurrency(
    extractFirstMatch(/total[^\d]*(\d+[\d.,]*)/i, normalizedText, 1)
  );

  const lineItems = buildLineItems(lines, subtotal);

  return {
    vendor,
    invoiceNumber: invoiceNumber || "",
    invoiceDate,
    subtotal: isFiniteNumber(subtotal) ? subtotal : 0,
    tax: isFiniteNumber(tax) ? tax : 0,
    total: isFiniteNumber(total) ? total : 0,
    lineItems
  };
}

function extractFirstMatch(regex, text, group = 0) {
  const match = text.match(regex);
  if (match && match[group]) {
    return match[group].trim();
  }
  return null;
}

function parseCurrency(value) {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(raw) {
  if (!raw) {
    return null;
  }

  const parts = raw.split(/[\/\-]/).map((part) => part.padStart(2, "0"));
  if (parts.length === 3) {
    let [month, day, year] = parts;
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return raw;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildLineItems(lines, fallbackTotal) {
  const items = [];
  const lineRegex = /(.*?)(?:\s{2,}|\t)(\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)/i;

  lines.forEach((line) => {
    const match = line.match(lineRegex);
    if (match) {
      const description = match[1].trim();
      const quantity = parseFloat(match[2]);
      const unitPrice = parseFloat(match[3]);
      const lineTotal = quantity * unitPrice;
      items.push({ description, quantity, unitPrice, lineTotal });
    }
  });

  if (items.length === 0) {
    // Placeholder until more advanced table parsing is implemented.
    items.push({
      description: "See OCR output for detailed line items",
      quantity: 1,
      unitPrice: isFiniteNumber(fallbackTotal) ? fallbackTotal : 0,
      lineTotal: isFiniteNumber(fallbackTotal) ? fallbackTotal : 0
    });
  }

  return items;
}
