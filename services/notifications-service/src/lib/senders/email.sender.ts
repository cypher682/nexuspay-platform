import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { logger } from "../logger";
import type { NotificationSender } from "./index";

const transport = nodemailer.createTransport(env.SMTP_URL);

export const emailSender: NotificationSender = {
  async send(recipient, subject, body) {
    const info = await transport.sendMail({
      from: env.SMTP_FROM,
      to: recipient,
      subject,
      text: body
    });
    logger.info("Email dispatched", { recipient, messageId: info.messageId });
    return { providerMessageId: info.messageId };
  }
};
