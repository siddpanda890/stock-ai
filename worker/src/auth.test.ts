import { describe, expect, it } from "vitest";
import { getUserFromToken, loginUser, registerUser } from "./auth";

class MemoryKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("auth", () => {
  it("registers, logs in, and verifies tokens with the provided secret", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const jwtSecret = "test-jwt-secret";

    const registered = await registerUser(kv, "sidd", "sidd@example.com", "hunter22", jwtSecret);
    expect("error" in registered).toBe(false);
    if ("error" in registered) return;

    const auth = await getUserFromToken(kv, registered.token, jwtSecret);
    expect(auth?.user.username).toBe("sidd");

    const loggedIn = await loginUser(kv, "sidd", "hunter22", jwtSecret);
    expect("error" in loggedIn).toBe(false);
    if ("error" in loggedIn) return;

    const relogged = await getUserFromToken(kv, loggedIn.token, jwtSecret);
    expect(relogged?.user.email).toBe("sidd@example.com");
  });
});
