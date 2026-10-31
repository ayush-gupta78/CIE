// Discovery returns only documented chat models, never embedding/audio catalog entries.
// https://openrouter.ai/docs  https://docs.api.nvidia.com/nim/docs/models
// https://console.groq.com/docs/api-reference
// https://api-docs.deepseek.com/api/list-models
// https://docs.mistral.ai/resources/migration-guides
// https://inference-docs.cerebras.ai/resources/openai
// https://docs.together.ai/reference/models
// https://docs.x.ai/developers/rest-api-reference/inference/models
export const hostedPresets = {
  fireworks: {
    providerName: "Fireworks AI",
    endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
  },
  xai: {
    providerName: "xAI",
    endpoint: "https://api.x.ai/v1/chat/completions",
    model: "grok-4.7",
  },
  openrouter: {
    providerName: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4o-mini",
  },
  nvidia: {
    providerName: "NVIDIA NIM",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "meta/llama-3.3-70b-instruct",
  },
  deepseek: {
    providerName: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
  },
  mistral: {
    providerName: "Mistral",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
  },
  cerebras: {
    providerName: "Cerebras",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    model: "qwen-3.8-27b",
  },
  together: {
    providerName: "Together AI",
    endpoint: "https://api.together.ai/v1/chat/completions",
    model: "Qwen/Qwen3.5-9B",
  },
  groq: {
    providerName: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
} as const;

// Manual selection avoids silently running a model with unknown pricing.
export const manualPresets = {
  // https://docs.sambanova.ai/docs/en/features/openai-compatibility
  sambanova: {
    providerName: "SambaNova",
    endpoint: "https://api.sambanova.ai/v1/chat/completions",
    protocol: "openai-compatible",
    model: "",
    discoveryModel: "Meta-Llama-3.3-70B-Instruct",
  },
  // https://blogs.novita.ai/ling-3-0-tiny-quick-start-for-chat-completions
  novita: {
    providerName: "Novita",
    endpoint: "https://api.novita.ai/openai/v1/chat/completions",
    protocol: "openai-compatible",
    model: "",
    discoveryModel: "inclusionai/ling-3.0-tiny",
  },
  cohere: {
    providerName: "Cohere",
    endpoint: "https://api.cohere.com/v2/chat",
    protocol: "cohere",
    model: "",
  },
  huggingface: {
    providerName: "Hugging Face",
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    protocol: "openai-compatible",
    model: "",
  },
} as const;
