import { messagingApi } from "@line/bot-sdk";
import { getEnv } from "./config";

let client: messagingApi.MessagingApiClient | null = null;

/** Shared LINE Messaging API client, created on first use. */
export function line(): messagingApi.MessagingApiClient {
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: getEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    });
  }
  return client;
}

/** Reject after `ms` so a slow call can't eat the 10s function budget. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
