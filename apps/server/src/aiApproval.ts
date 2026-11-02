import { randomBytes } from "node:crypto";
import {
  assertScreenedPayload,
  serializeProviderRequest,
  type ProviderConfig,
} from "./aiProvider.js";

type Snapshot = {
  repositoryId: string;
  revision: number;
  manifest: string;
  fileId?: string;
};
type Message = { role: "system" | "user" | "assistant"; content: string };

export class AiApproval {
  private pending?: {
    id: string;
    snapshot: Snapshot;
    config: ProviderConfig;
    messages: Message[];
    payload: string;
    created: number;
  };

  prepare(
    config: ProviderConfig,
    messages: Message[],
    snapshot: Snapshot,
    warnings: string[] = [],
  ) {
    const payload = serializeProviderRequest(config, messages);
    assertScreenedPayload(payload);
    if (
      config.key &&
      [payload, config.endpoint, config.model, config.providerName].some(
        (part) =>
          part.includes(config.key!) ||
          part.includes(JSON.stringify(config.key).slice(1, -1)),
      )
    )
      throw new Error("AI outbound data contains the configured credential.");
    const id = randomBytes(24).toString("hex");
    this.pending = {
      id,
      snapshot: { ...snapshot },
      config: { ...config },
      messages,
      payload,
      created: Date.now(),
    };
    return {
      id,
      snapshot: { ...snapshot },
      destination: {
        endpoint: config.endpoint,
        protocol: config.protocol,
        model: config.model,
        providerName: config.providerName,
      },
      payload,
      expiresAt: this.pending.created + 60_000,
      warnings: [...warnings],
    };
  }

  async approve<T>(
    id: string,
    snapshot: Snapshot,
    config: ProviderConfig,
    validate: () => Promise<void>,
    send: (
      config: ProviderConfig,
      messages: Message[],
      payload: string,
    ) => Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    const pending = this.pending;
    this.pending = undefined; // Consume before async validation, even on failure.
    if (
      !pending ||
      pending.id !== id ||
      now > pending.created + 60_000 ||
      JSON.stringify(snapshot) !== JSON.stringify(pending.snapshot) ||
      JSON.stringify(config) !== JSON.stringify(pending.config) ||
      serializeProviderRequest(config, pending.messages) !== pending.payload
    )
      throw new Error("AI approval is invalid or expired.");
    await validate();
    if (
      JSON.stringify(config) !== JSON.stringify(pending.config) ||
      serializeProviderRequest(config, pending.messages) !== pending.payload
    )
      throw new Error("AI approval no longer matches outbound data.");
    return send(config, pending.messages, pending.payload);
  }

  clear() {
    this.pending = undefined;
  }
}
