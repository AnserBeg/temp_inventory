export type EmailProvider = "google" | "microsoft";
export type EmailDocumentType = "purchase_order" | "sales_order" | "customer_invoice";
export type PrintableDocumentType = EmailDocumentType | "vendor_bill";

export type EmailConnectionState = {
  configuredProviders: Array<{ provider: EmailProvider; label: string }>;
  connection: null | {
    provider: EmailProvider;
    providerLabel: string;
    emailAddress: string;
    status: string;
    connectedAt: string;
    lastError?: string;
  };
};

export type DocumentEmailPreview = {
  documentType: EmailDocumentType;
  documentId: string;
  documentNumber: string;
  documentLabel: string;
  partyName: string;
  defaultRecipient: string;
  defaultSubject: string;
  defaultMessage: string;
  fileName: string;
};
