import nodemailer from "nodemailer";

export type SmtpConnectionOptions = {
  emailAddress: string;
  host: string;
  port: number;
  username: string;
  password: string;
};

type SmtpTransport = {
  verify(): Promise<unknown>;
  sendMail(input: Record<string, unknown>): Promise<{ messageId?: string }>;
  close?(): void;
};

type SmtpTransportFactory = (input: SmtpConnectionOptions) => SmtpTransport;
let testTransportFactory: SmtpTransportFactory | null = null;

/** Allows integration tests to exercise SMTP storage and routing without external mail. */
export function setSmtpTransportFactoryForTests(factory: SmtpTransportFactory | null) {
  testTransportFactory = factory;
}

function createSmtpTransport(input: SmtpConnectionOptions): SmtpTransport {
  if (testTransportFactory) return testTransportFactory(input);
  return nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.port === 465,
    requireTLS: input.port !== 465,
    auth: { user: input.username, pass: input.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  }) as SmtpTransport;
}

export async function verifySmtpConnection(input: SmtpConnectionOptions) {
  const transport = createSmtpTransport(input);
  try { await transport.verify(); }
  finally { transport.close?.(); }
}

export async function sendSmtpMessage(input: SmtpConnectionOptions & {
  recipients: string[];
  subject: string;
  htmlBody: string;
  fileName?: string;
  pdf?: Uint8Array;
}) {
  const transport = createSmtpTransport(input);
  try {
    const sent = await transport.sendMail({
      from: input.emailAddress,
      to: input.recipients,
      subject: input.subject,
      html: input.htmlBody,
      ...(input.fileName && input.pdf ? { attachments: [{ filename: input.fileName, content: Buffer.from(input.pdf), contentType: "application/pdf" }] } : {}),
    });
    return { messageId: String(sent.messageId ?? "") };
  } finally { transport.close?.(); }
}
