import { Queue } from "bullmq";
import { bullMqConnectionOptions } from "../lib/redis";
import { QUEUES } from "./names";

export const paymentProcessingQueue = new Queue(QUEUES.paymentProcessing, {
  connection: bullMqConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200
  }
});
