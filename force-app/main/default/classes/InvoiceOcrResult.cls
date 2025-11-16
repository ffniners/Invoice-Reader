// File: force-app/main/default/classes/InvoiceOcrResult.cls
// Description: DTO for normalized invoice OCR results returned by the Node microservice.
@AuraEnabled(cacheable=true)
public with sharing class InvoiceOcrResult {
  @AuraEnabled
  public String vendor;
  @AuraEnabled
  public String invoiceNumber;
  @AuraEnabled
  public Date invoiceDate;
  @AuraEnabled
  public Decimal subtotal;
  @AuraEnabled
  public Decimal tax;
  @AuraEnabled
  public Decimal total;
  @AuraEnabled
  public List<LineItem> lineItems;

  // Ensure lineItems is always initialized for consumers.
  public InvoiceOcrResult() {
    lineItems = new List<LineItem>();
  }

  @AuraEnabled(cacheable=true)
  public class LineItem {
    @AuraEnabled
    public String description;
    @AuraEnabled
    public Decimal quantity;
    @AuraEnabled
    public Decimal unitPrice;
    @AuraEnabled
    public Decimal lineTotal;
  }

  /**
   * Deserialize JSON from the OCR microservice into an InvoiceOcrResult instance.
   * @param jsonString The JSON payload to parse.
   * @return A populated InvoiceOcrResult or an empty instance when parsing fails.
   */
  public static InvoiceOcrResult fromJson(String jsonString) {
    if (String.isBlank(jsonString)) {
      return new InvoiceOcrResult();
    }

    try {
      InvoiceOcrResult parsed = (InvoiceOcrResult) JSON.deserialize(
        jsonString,
        InvoiceOcrResult.class
      );
      if (parsed == null) {
        return new InvoiceOcrResult();
      }
      if (parsed.lineItems == null) {
        parsed.lineItems = new List<LineItem>();
      }
      return parsed;
    } catch (Exception ex) {
      // On any parsing exception, return an empty DTO to keep callers resilient.
      return new InvoiceOcrResult();
    }
  }
}
