import { HttpError } from "../../middleware/error-handler";
import type { Channel } from "@prisma/client";
import { emailSender } from "./email.sender";
import { smsSender } from "./sms.sender";

export interface NotificationSender {
  send(recipient: string, subject: string, body: string): Promise<{ providerMessageId: string }>;
}

export function getSender(channel: Channel): NotificationSender {
  switch (channel) {
    case "EMAIL":
      return emailSender;
    case "SMS":
      return smsSender;
    default:
      throw new HttpError(422, `Unsupported notification channel: ${String(channel)}`);
  }
}
