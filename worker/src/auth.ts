// Authentication System - JWT + PBKDF2 password hashing + KV storage
// No external dependencies, uses Web Crypto API (available in Workers)

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLogin: string;
  settings: UserSettings;
}

export interface UserSettings {
  defaultModel: string;
  theme: string;
  alertsEnabled: boolean;
}

interface InitialPortfolio {
  holdings: [];
  trades: [];
  cash: number;
  initialCapital: number;
  realizedPnl: number;
  totalTradeCount: number;
  winCount: number;
}

export interface UserPublic {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  lastLogin: string;
  settings: UserSettings;
}

// ─── Password Hashing (PBKDF2 via Web Crypto) ────────

async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt
    ? hexToBytes(salt)
    : crypto.getRandomValues(new Uint8Array(32));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
  };
}

async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

// ─── JWT Token Management ─────────────────────────────

interface JWTPayload {
  sub: string; // user id
  username: string;
  iat: number;
  exp: number;
}

async function createJWT(
  payload: Omit<JWTPayload, "iat" | "exp">,
  secret: string,
  expiresInHours: number = 72
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInHours * 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = base64urlDecode(encodedSignature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload: JWTPayload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── User CRUD Operations ─────────────────────────────

function userKey(username: string): string {
  return `user:${username.toLowerCase()}`;
}

function userIdKey(id: string): string {
  return `userid:${id}`;
}

export async function registerUser(
  kv: KVNamespace,
  username: string,
  email: string,
  password: string,
  jwtSecret: string
): Promise<{ user: UserPublic; token: string } | { error: string }> {
  // Validate
  if (!username || username.length < 3)
    return { error: "Username must be at least 3 characters" };
  if (!password || password.length < 6)
    return { error: "Password must be at least 6 characters" };
  if (!email || !email.includes("@"))
    return { error: "Valid email required" };

  // Check if user exists
  const existing = await kv.get(userKey(username));
  if (existing) return { error: "Username already taken" };

  // Hash password
  const { hash, salt } = await hashPassword(password);

  // Create user
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const user: User = {
    id,
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    passwordHash: hash,
    salt,
    createdAt: now,
    lastLogin: now,
    settings: {
      defaultModel: "sonnet-4.6",
      theme: "dark",
      alertsEnabled: true,
    },
  };

  // Store user by username and by id
  await kv.put(userKey(username), JSON.stringify(user));
  await kv.put(userIdKey(id), username.toLowerCase());

  // Initialize empty portfolio and watchlist
  const initialPortfolio: InitialPortfolio = {
    holdings: [],
    trades: [],
    cash: 100000,
    initialCapital: 100000,
    realizedPnl: 0,
    totalTradeCount: 0,
    winCount: 0,
  };
  await kv.put(`portfolio:${id}`, JSON.stringify(initialPortfolio));
  await kv.put(`watchlist:${id}`, JSON.stringify(["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META"]));
  await kv.put(`alerts:${id}`, JSON.stringify([]));

  const token = await createJWT({ sub: id, username: user.username }, jwtSecret);

  return { user: toPublic(user), token };
}

export async function loginUser(
  kv: KVNamespace,
  username: string,
  password: string,
  jwtSecret: string
): Promise<{ user: UserPublic; token: string } | { error: string }> {
  const data = await kv.get(userKey(username));
  if (!data) return { error: "Invalid username or password" };

  const user: User = JSON.parse(data);
  const valid = await verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) return { error: "Invalid username or password" };

  // Update last login
  user.lastLogin = new Date().toISOString();
  await kv.put(userKey(username), JSON.stringify(user));

  const token = await createJWT({ sub: user.id, username: user.username }, jwtSecret);

  return { user: toPublic(user), token };
}

export async function getUserFromToken(
  kv: KVNamespace,
  token: string,
  secret: string
): Promise<{ user: User; payload: JWTPayload } | null> {
  const payload = await verifyJWT(token, secret);
  if (!payload) return null;

  const username = await kv.get(userIdKey(payload.sub));
  if (!username) return null;

  const data = await kv.get(userKey(username));
  if (!data) return null;

  return { user: JSON.parse(data), payload };
}

export async function updateUserSettings(
  kv: KVNamespace,
  userId: string,
  settings: Partial<UserSettings>
): Promise<UserPublic | null> {
  const username = await kv.get(userIdKey(userId));
  if (!username) return null;

  const data = await kv.get(userKey(username));
  if (!data) return null;

  const user: User = JSON.parse(data);
  user.settings = { ...user.settings, ...settings };
  await kv.put(userKey(username), JSON.stringify(user));

  return toPublic(user);
}

function toPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    settings: user.settings,
  };
}

// ─── Utility Functions ────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function base64url(input: string | ArrayBuffer): string {
  if (typeof input === "string") {
    return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
