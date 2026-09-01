import crypto from "node:crypto";
import { logger } from "../logger";
import type { NotificationSender } from "./index";

export const smsSender: NotificationSender = {
  async send(recipient, subject, body) {
    const providerMessageId = `sms_mock_${crypto.randomBytes(8).toString("hex")}`;
    logger.info("Mock SMS dispatched", { recipient, subject, body, providerMessageId });
    return { providerMessageId };
  }
};
