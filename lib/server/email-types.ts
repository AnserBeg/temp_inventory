export type OAuthEmailProvider = "google" | "microsoft";
export type EmailProvider = OAuthEmailProvider | "smtp";
export type EmailSenderType = "company" | "personal";
export type EmailDocumentType = "purchase_order" | "sales_order" | "customer_invoice" | "vendor_bill" | "work_order";
export type PrintableDocumentType = EmailDocumentType;

export type EmailConnectionSummary = {
  senderType: EmailSenderType;
  provider: EmailProvider;
  providerLabel: string;
  emailAddress: string;
  status: string;
  connectedAt: string;
  lastError?: string;
};

export type EmailConnectionState = {
  configuredProviders: Array<{ provider: OAuthEmailProvider; label: string }>;
  companyConnection: EmailConnectionSummary | null;
  personalConnection: EmailConnectionSummary | null;
  defaultSender: EmailSenderType | null;
  canManageCompany: boolean;
  purchaseOrderApprovalEmail: string;
  purchaseOrderApprovedEmails: string;
  /** The sender selected automatically: company first, then personal. */
  connection: EmailConnectionSummary | null;
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
