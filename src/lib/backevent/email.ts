import { Resend } from "resend";

export const emailCategories = [
  "inventory_low_stock",
  "inventory_critical_stock",
  "inventory_report",
  "general_message",
] as const;

export type BackEventEmailCategory = (typeof emailCategories)[number];

export type SendBackEventEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  category: BackEventEmailCategory;
};

let resendClient: Resend | null = null;

export function isBackEventEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.BACKEVENT_EMAIL_FROM);
}

export async function sendBackEventEmail({ to, subject, html, text, category }: SendBackEventEmailInput) {
  if (!emailCategories.includes(category)) {
    throw new Error("Ukendt email-kategori");
  }

  if (!isBackEventEmailConfigured()) {
    throw new Error("Email er ikke konfigureret");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  const { data, error } = await resendClient.emails.send({
    from: process.env.BACKEVENT_EMAIL_FROM!,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(error.message || "Email kunne ikke sendes");
  }

  return {
    id: data?.id ?? null,
  };
}

export function messageToEmailHtml(message: string) {
  const escaped = escapeHtml(message).replace(/\r?\n/g, "<br />");
  return `
    <div style="font-family: Ubuntu, Arial, sans-serif; color: #1f2933; line-height: 1.5;">
      <div style="border-left: 6px solid #fcc146; padding-left: 16px;">
        <h1 style="font-size: 22px; margin: 0 0 12px;">BackEvent</h1>
        <p style="margin: 0;">${escaped}</p>
      </div>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
