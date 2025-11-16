// File: force-app/main/default/classes/InvoiceOcrService.cls
// Description: Service responsible for invoking the external OCR microservice via named credential.
public with sharing class InvoiceOcrService {
  private static final String NAMED_CREDENTIAL_ENDPOINT = 'callout:Invoice_OCR_Service/analyze-invoice';

  /**
   * Sends the ContentVersion binary to the OCR microservice and returns the normalized result.
   * @param contentVersionId The Id of the ContentVersion to analyze.
   * @param targetRecordId The Salesforce record associated with the invoice (reserved for future use).
   */
  public static InvoiceOcrResult analyzeInvoice(
    Id contentVersionId,
    Id targetRecordId
  ) {
    if (contentVersionId == null) {
      throw new IllegalArgumentException(
        'ContentVersionId is required for OCR analysis.'
      );
    }

    try {
      ContentVersion cv = [
        SELECT Id, VersionData, FileType, Title
        FROM ContentVersion
        WHERE Id = :contentVersionId
        LIMIT 1
      ];

      HttpRequest request = new HttpRequest();
      request.setEndpoint(NAMED_CREDENTIAL_ENDPOINT);
      request.setMethod('POST');
      request.setHeader('Content-Type', 'application/json');

      Map<String, Object> payload = new Map<String, Object>{
        'fileName' => inferFileName(cv),
        'fileType' => cv.FileType,
        'fileContentBase64' => EncodingUtil.base64Encode(cv.VersionData)
      };

      request.setBody(JSON.serialize(payload));

      Http http = new Http();
      HttpResponse response = http.send(request);

      if (response.getStatusCode() != 200) {
        String responseBody = response.getBody();
        System.debug(
          LoggingLevel.ERROR,
          'Invoice OCR service error: ' + responseBody
        );
        throw new CalloutException(
          'Invoice OCR service returned status ' +
            response.getStatusCode() +
            ' - ' +
            responseBody
        );
      }

      return InvoiceOcrResult.fromJson(response.getBody());
    } catch (CalloutException ex) {
      throw ex;
    } catch (Exception ex) {
      System.debug(
        LoggingLevel.ERROR,
        'Unexpected error during Invoice OCR callout: ' + ex.getMessage()
      );
      throw new CalloutException(
        'Failed to analyze invoice via OCR: ' + ex.getMessage()
      );
    }
  }

  @TestVisible
  private static String inferFileName(ContentVersion cv) {
    String baseName = String.isNotBlank(cv.Title) ? cv.Title : 'invoice';
    if (String.isBlank(cv.FileType) || cv.FileType == 'UNKNOWN') {
      return baseName;
    }

    String extension = '.' + cv.FileType.toLowerCase();
    if (baseName.toLowerCase().endsWith(extension)) {
      return baseName;
    }

    return baseName + extension;
  }
}
