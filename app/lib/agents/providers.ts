export type ModelProvider = "OPENAI" | "ANTHROPIC" | "GEMINI" | "CLOUDFLARE_WORKERS_AI";
export type ProviderAuthenticationMode = "API_KEY" | "OAUTH" | "RUNNER_SESSION";

export type ProviderConfiguration = {
  provider: ModelProvider;
  authenticationMode: ProviderAuthenticationMode;
  active: boolean;
  integration: string;
};

// This registry deliberately does not instantiate another SDK client. Existing
// content workflows remain the sole active OpenAI implementation.
export const MODEL_PROVIDERS: ProviderConfiguration[] = [
  { provider:"OPENAI", authenticationMode:"API_KEY", active:true, integration:"Reuse existing server-only content generation modules" },
  { provider:"ANTHROPIC", authenticationMode:"API_KEY", active:false, integration:"Not connected" },
  { provider:"GEMINI", authenticationMode:"API_KEY", active:false, integration:"Not connected" },
  { provider:"CLOUDFLARE_WORKERS_AI", authenticationMode:"RUNNER_SESSION", active:false, integration:"Not connected" },
];

export function activeModelProvider() { return MODEL_PROVIDERS.find(provider=>provider.active) || null; }
