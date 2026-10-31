import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailConfig {
  transport: "console" | "smtp";
  from: string;
  smtpHost?: string;
  smtpPort?: number;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<{ id: string; transport: string }>;
}

export function createEmailAdapter(config: EmailConfig): EmailAdapter {
  if (config.transport === "smtp") {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost ?? "localhost",
      port: config.smtpPort ?? 1025,
      secure: false,
    });
    return {
      async send(message) {
        const info = await transporter.sendMail({ from: config.from, ...message });
        return { id: info.messageId ?? "smtp", transport: "smtp" };
      },
    };
  }
  return {
    async send(message) {
      const id = `console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ level: "info", type: "email", id, from: config.from, ...message }));
      return { id, transport: "console" };
    },
  };
}
