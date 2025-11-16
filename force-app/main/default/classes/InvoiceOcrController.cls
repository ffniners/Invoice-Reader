// File: force-app/main/default/classes/InvoiceOcrController.cls
// Description: Apex controller exposing OCR actions for the invoice upload LWC.
public with sharing class InvoiceOcrController {
  /**
   * Initiates OCR processing for the provided ContentVersion and returns structured suggestions.
   */
  @AuraEnabled(cacheable=false)
  public static InvoiceOcrResult startOcr(Id contentVersionId, Id recordId) {
    try {
      return InvoiceOcrService.analyzeInvoice(contentVersionId, recordId);
    } catch (Exception ex) {
      throw new AuraHandledException('Failed to start OCR: ' + ex.getMessage());
    }
  }

  /**
   * Applies the supplied OCR suggestions to the Purchase_Order__c record.
   */
  @AuraEnabled
  public static void applySuggestions(
    Id recordId,
    InvoiceOcrResult suggestions
  ) {
    try {
      if (recordId == null) {
        throw new AuraHandledException(
          'A record Id is required to apply suggestions.'
        );
      }
      if (suggestions == null) {
        throw new AuraHandledException('Suggestions payload is required.');
      }

      Purchase_Order__c po = [
        SELECT
          Id,
          Vendor__c,
          Invoice_Number__c,
          Invoice_Date__c,
          Subtotal__c,
          Tax__c,
          Total__c
        FROM Purchase_Order__c
        WHERE Id = :recordId
        LIMIT 1
      ];

      po.Vendor__c = suggestions.vendor;
      po.Invoice_Number__c = suggestions.invoiceNumber;
      po.Invoice_Date__c = suggestions.invoiceDate;
      po.Subtotal__c = suggestions.subtotal;
      po.Tax__c = suggestions.tax;
      po.Total__c = suggestions.total;

      // TODO: map line items when the Purchase_Order__c line item structure is defined.

      update po;
    } catch (AuraHandledException ex) {
      throw ex;
    } catch (Exception ex) {
      throw new AuraHandledException(
        'Failed to apply OCR suggestions: ' + ex.getMessage()
      );
    }
  }
}
