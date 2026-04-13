// Vega AI Engine - Multi-model AI pipeline
// Supports Vega Ultra, Pro, and Lite model tiers

interface VertexAIConfig {
  projectId: string;
  location: string;
  serviceAccountJson: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface VertexResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

// Generate JWT from service account
async function createJWT(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  };

  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Import the private key for signing
  const pemKey = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${signingInput}.${encodedSignature}`;
}

// Get OAuth2 access token from JWT
async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountJson);
  const jwt = await createJWT(serviceAccount);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = (await tokenResponse.json()) as any;
  if (!tokenData.access_token) {
    throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// Available Vega AI models — Claude (Anthropic via Vertex AI)
export const CLAUDE_MODELS = {
  "opus-4.6": "claude-opus-4-6@20250514",
  "sonnet-4.6": "claude-sonnet-4-6@20250514",
  "haiku-4.5": "claude-haiku-4-5-20251001",
} as const;

// Gemini models (Google via Vertex AI — same project, different publisher)
export const GEMINI_MODELS = {
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
} as const;

// OpenAI models via Azure (Chat Completions API + Responses API)
export const OPENAI_MODELS = {
  "gpt-5.4-pro": "gpt-5.4-pro",   // Best reasoning — Responses API
  "gpt-5.4": "gpt-5.4",           // Strong general — Responses API
  "o4-mini": "o4-mini",           // Fast reasoning — Chat Completions (Foundry)
  "gpt-4.1": "gpt-4.1",          // Fast & cheap — Chat Completions (Foundry)
} as const;

// Combined model map for backwards compat
export const MODELS = {
  ...CLAUDE_MODELS,
  ...GEMINI_MODELS,
  ...OPENAI_MODELS,
} as const;

export type ModelKey = keyof typeof MODELS;
export type ClaudeModelKey = keyof typeof CLAUDE_MODELS;
export type GeminiModelKey = keyof typeof GEMINI_MODELS;
export type OpenAIModelKey = keyof typeof OPENAI_MODELS;

function isClaudeModel(model: ModelKey): model is ClaudeModelKey {
  return model in CLAUDE_MODELS;
}
function isGeminiModel(model: ModelKey): model is GeminiModelKey {
  return model in GEMINI_MODELS;
}
function isOpenAIModel(model: ModelKey): model is OpenAIModelKey {
  return model in OPENAI_MODELS;
}

// ═══════════════════════════════════════════════════════
// CLAUDE via Vertex AI (Anthropic publisher)
// ═══════════════════════════════════════════════════════

export async function callClaudeVertexAI(
  config: VertexAIConfig,
  messages: Message[],
  systemPrompt: string,
  model: ClaudeModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  const accessToken = await getAccessToken(config.serviceAccountJson);
  const modelId = CLAUDE_MODELS[model];

  const endpoint = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/anthropic/models/${modelId}:rawPredict`;

  const body = {
    anthropic_version: "vertex-2023-10-16",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vertex AI Claude error (${response.status}): ${err}`);
  }

  return (await response.json()) as VertexResponse;
}

// ═══════════════════════════════════════════════════════
// GEMINI via Vertex AI (Google publisher)
// ═══════════════════════════════════════════════════════

async function callGeminiVertexAI(
  config: VertexAIConfig,
  messages: Message[],
  systemPrompt: string,
  model: GeminiModelKey = "gemini-2.5-pro",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  const accessToken = await getAccessToken(config.serviceAccountJson);
  const modelId = GEMINI_MODELS[model];

  const endpoint = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${modelId}:generateContent`;

  // Convert messages to Gemini format
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vertex AI Gemini error (${response.status}): ${err}`);
  }

  const geminiResp = (await response.json()) as any;

  // Normalize Gemini response → VertexResponse format
  const text = geminiResp.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text)
    .join("") || "";
  const usage = geminiResp.usageMetadata || {};

  return {
    content: [{ type: "text", text }],
    model: modelId,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════
// OPENAI GPT via Azure (two endpoints)
//   - Foundry (Chat Completions): gpt-4.1, o4-mini
//   - Classic (Responses API): gpt-5.4, gpt-5.4-pro
// ═══════════════════════════════════════════════════════

const AZURE_FOUNDRY_BASE = "https://openai-image15-resource.services.ai.azure.com";
const AZURE_CLASSIC_BASE = "https://openai-image15-resource.openai.azure.com";

// Models that use Responses API (GPT-5.x series)
const RESPONSES_API_MODELS = new Set(["gpt-5.4", "gpt-5.4-pro"]);
// Reasoning models — no temperature, use max_completion_tokens
const REASONING_MODELS = new Set(["o4-mini"]);

// Chat Completions API (gpt-4.1, o4-mini via Foundry)
async function callAzureChatCompletions(
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  model: OpenAIModelKey,
  maxTokens: number
): Promise<VertexResponse> {
  const deployment = OPENAI_MODELS[model];
  const isReasoning = REASONING_MODELS.has(model);

  const openAIMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const endpoint = `${AZURE_FOUNDRY_BASE}/openai/deployments/${deployment}/chat/completions?api-version=2024-12-01-preview`;

  const body: any = { messages: openAIMessages };
  if (isReasoning) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.7;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Azure ChatCompletions error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as any;
  return {
    content: [{ type: "text", text: data.choices?.[0]?.message?.content || "" }],
    model: data.model || model,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

// Responses API (gpt-5.4, gpt-5.4-pro via Classic endpoint)
async function callAzureResponses(
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  model: OpenAIModelKey,
  maxTokens: number
): Promise<VertexResponse> {
  const endpoint = `${AZURE_CLASSIC_BASE}/openai/responses?api-version=2025-03-01-preview`;

  // Build input: system instructions + conversation as text
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const body: any = {
    model: OPENAI_MODELS[model],
    instructions: systemPrompt,
    input: conversationText,
    max_output_tokens: maxTokens,
    temperature: 0.7,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Azure Responses API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as any;

  // Extract text from Responses API output format
  let text = "";
  for (const item of data.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") text += c.text;
      }
    }
  }

  const usage = data.usage || {};
  return {
    content: [{ type: "text", text }],
    model: data.model || model,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    },
  };
}

// Unified Azure OpenAI caller — routes to correct API
async function callAzureOpenAI(
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  model: OpenAIModelKey = "gpt-4.1",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  if (RESPONSES_API_MODELS.has(model)) {
    return callAzureResponses(apiKey, messages, systemPrompt, model, maxTokens);
  }
  return callAzureChatCompletions(apiKey, messages, systemPrompt, model, maxTokens);
}

// ═══════════════════════════════════════════════════════
// UNIFIED ROUTER — call any model through one function
// ═══════════════════════════════════════════════════════

// Legacy alias — routes to correct provider
export async function callVertexAI(
  config: VertexAIConfig,
  messages: Message[],
  systemPrompt: string,
  model: ModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  if (isGeminiModel(model)) {
    return callGeminiVertexAI(config, messages, systemPrompt, model, maxTokens);
  }
  if (isClaudeModel(model)) {
    return callClaudeVertexAI(config, messages, systemPrompt, model, maxTokens);
  }
  // OpenAI models shouldn't come through here, but handle gracefully
  throw new Error(`Model ${model} requires OpenAI API key — use callAI() instead`);
}

// ═══════════════════════════════════════════════════════
// UNIVERSAL AI CALLER — routes to correct provider with fallbacks
// ═══════════════════════════════════════════════════════

export interface AIConfig {
  vertex: VertexAIConfig;
  anthropicApiKey: string;
  azureOpenaiApiKey?: string;
}

export async function callAI(
  config: AIConfig,
  messages: Message[],
  systemPrompt: string,
  model: ModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  // ── OpenAI models → Azure OpenAI ──
  if (isOpenAIModel(model)) {
    if (!config.azureOpenaiApiKey) {
      throw new Error(`Azure OpenAI API key required for model ${model}`);
    }
    return callAzureOpenAI(config.azureOpenaiApiKey, messages, systemPrompt, model, maxTokens);
  }

  // ── Gemini models → Vertex AI (Google publisher) ──
  if (isGeminiModel(model)) {
    return callGeminiVertexAI(config.vertex, messages, systemPrompt, model, maxTokens);
  }

  // ── Claude models → Vertex AI with Anthropic API fallback ──
  try {
    return await callClaudeVertexAI(config.vertex, messages, systemPrompt, model as ClaudeModelKey, maxTokens);
  } catch (vertexError) {
    console.warn("Vertex AI Claude failed, falling back to Anthropic API:", vertexError);

    const anthropicModel =
      model === "opus-4.6"
        ? "claude-opus-4-6"
        : model === "sonnet-4.6"
        ? "claude-sonnet-4-6"
        : "claude-haiku-4-5-20251001";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    return (await response.json()) as VertexResponse;
  }
}

// Legacy alias — backwards compatible
export async function callClaude(
  config: VertexAIConfig,
  anthropicApiKey: string,
  messages: Message[],
  systemPrompt: string,
  model: ModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  return callAI(
    { vertex: config, anthropicApiKey },
    messages, systemPrompt, model, maxTokens
  );
}
