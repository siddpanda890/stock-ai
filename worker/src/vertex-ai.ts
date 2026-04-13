// Vertex AI Claude Integration - Uses Google Service Account for auth
// Supports Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 via Vertex AI

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

// Available Claude models on Vertex AI
export const MODELS = {
  "opus-4.6": "claude-opus-4-6@20250514",
  "sonnet-4.6": "claude-sonnet-4-6@20250514",
  "haiku-4.5": "claude-haiku-4-5-20251001",
} as const;

export type ModelKey = keyof typeof MODELS;

// Call Claude via Vertex AI
export async function callVertexAI(
  config: VertexAIConfig,
  messages: Message[],
  systemPrompt: string,
  model: ModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  const accessToken = await getAccessToken(config.serviceAccountJson);
  const modelId = MODELS[model];

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
    throw new Error(`Vertex AI error (${response.status}): ${err}`);
  }

  return (await response.json()) as VertexResponse;
}

// Convenience: Call with direct Anthropic API as fallback
export async function callClaude(
  config: VertexAIConfig,
  anthropicApiKey: string,
  messages: Message[],
  systemPrompt: string,
  model: ModelKey = "sonnet-4.6",
  maxTokens: number = 4096
): Promise<VertexResponse> {
  try {
    return await callVertexAI(config, messages, systemPrompt, model, maxTokens);
  } catch (vertexError) {
    console.warn("Vertex AI failed, falling back to Anthropic API:", vertexError);

    // Fallback to direct Anthropic API
    const anthropicModel =
      model === "opus-4.6"
        ? "claude-opus-4-6"
        : model === "sonnet-4.6"
        ? "claude-sonnet-4-6"
        : "claude-haiku-4-5-20251001";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
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
