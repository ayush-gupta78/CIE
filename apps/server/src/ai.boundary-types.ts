import type { ProviderCaller } from "./aiProvider.js";

// This is checked by the production typecheck, but never invoked.
function rawContentMustNotCompile(call: ProviderCaller, signal: AbortSignal) {
  call(
    {} as Parameters<ProviderCaller>[0],
    // @ts-expect-error unscreened strings cannot cross the provider boundary
    [{ role: "user", content: "raw secret" }],
    signal,
  );
}
void rawContentMustNotCompile;
