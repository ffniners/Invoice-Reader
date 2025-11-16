import { LightningElement, api, track } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import startOcr from "@salesforce/apex/InvoiceOcrController.startOcr";
import applySuggestions from "@salesforce/apex/InvoiceOcrController.applySuggestions";

export default class InvoiceUploadPanel extends LightningElement {
  @api recordId;
  @track invoiceResult;
  contentVersionId;
  isProcessing = false;

  get disableProcessButton() {
    return !this.contentVersionId || this.isProcessing;
  }

  handleUploadFinished(event) {
    const uploadedFiles = event.detail.files;
    if (uploadedFiles && uploadedFiles.length > 0) {
      this.contentVersionId = uploadedFiles[0].documentId;
      this.showToast(
        "Upload Complete",
        "File uploaded successfully. Ready to process.",
        "success"
      );
    }
  }

  async handleProcessInvoice() {
    if (!this.contentVersionId) {
      this.showToast(
        "No File",
        "Please upload a file before processing.",
        "warning"
      );
      return;
    }

    this.isProcessing = true;
    try {
      const result = await startOcr({
        contentVersionId: this.contentVersionId,
        recordId: this.recordId
      });
      this.invoiceResult = result;
      this.showToast(
        "Success",
        "OCR processing complete. Review suggestions below.",
        "success"
      );
    } catch (error) {
      this.showToast("Error", this.normalizeError(error), "error");
    } finally {
      this.isProcessing = false;
    }
  }

  async handleApplySuggestions() {
    if (!this.invoiceResult) {
      return;
    }

    try {
      await applySuggestions({
        recordId: this.recordId,
        suggestions: this.invoiceResult
      });
      this.showToast(
        "Success",
        "Suggestions applied to the record.",
        "success"
      );
    } catch (error) {
      this.showToast("Error", this.normalizeError(error), "error");
    }
  }

  showToast(title, message, variant) {
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant,
        mode: "dismissable"
      })
    );
  }

  normalizeError(error) {
    if (!error) {
      return "Unknown error";
    }
    if (Array.isArray(error.body)) {
      return error.body.map((e) => e.message).join(", ");
    }
    if (error.body && typeof error.body.message === "string") {
      return error.body.message;
    }
    return typeof error.message === "string"
      ? error.message
      : "An unexpected error occurred.";
  }
}
