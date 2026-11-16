import nodemailer from "nodemailer";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";

/**
 * Contrat d'intégration email. `console` : développement (lien affiché et journalisé).
 * `smtp` : fournisseur transactionnel via SMTP_URL. Sans fournisseur en
 * production, l'envoi échoue explicitement : aucun lien n'est présenté comme envoyé.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailDelivery = "console" | "smtp";

export async function sendEmail(msg: EmailMessage): Promise<EmailDelivery> {
  const provider = env.emailProvider;
  if (provider === "console") {
    console.info(`[email:console] À : ${msg.to}\nObjet : ${msg.subject}\n${msg.text}`);
    return "console";
  }
  if (provider === "smtp") {
    const url = process.env.SMTP_URL;
    if (!url) throw new AppError("NOT_CONNECTED", "SMTP_URL manquant : envoi d'email à connecter.");
    const transport = nodemailer.createTransport(url);
    await transport.sendMail({ from: process.env.EMAIL_FROM ?? "KIVMO <no-reply@localhost>", to: msg.to, subject: msg.subject, text: msg.text });
    return "smtp";
  }
  throw new AppError("NOT_CONNECTED", "Aucun fournisseur d'email configuré. Utilisez le mode démonstration.");
}
