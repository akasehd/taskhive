import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const COST = Number(process.env.SCRYPT_COST ?? 16384);
const SESSION_MS = 30 * 86_400_000;
export const COOKIE = "taskhive_session";

const COLORS = ["#2f6fdb", "#d9480f", "#2b8a3e", "#ae3ec9", "#c2255c", "#0b7285", "#e67700", "#5f3dc4"];

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: COST });
  return `scrypt$${COST}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [, n, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n) });
  return timingSafeEqual(actual, expected);
}

export const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, color: u.color };

export function authService(db) {
  let dummy;
  return {
    async register({ email, name, password }) {
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return null;
      const color = COLORS[db.prepare("SELECT COUNT(*) AS n FROM users").get().n % COLORS.length];
      const { lastInsertRowid } = db
        .prepare("INSERT INTO users (email, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(email, name, await hashPassword(password), color, Date.now());
      return db.prepare("SELECT * FROM users WHERE id = ?").get(lastInsertRowid);
    },
    async login({ email, password }) {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      dummy ??= await hashPassword(randomBytes(8).toString("hex"));
      const ok = await verifyPassword(password, user?.password_hash ?? dummy);
      return user && ok ? user : null;
    },
    createSession(userId) {
      const token = randomBytes(32).toString("base64url");
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, Date.now() + SESSION_MS);
      return token;
    },
    userForToken(token) {
      if (!token) return null;
      const row = db.prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
      ).get(sha256(token), Date.now());
      return row ?? null;
    },
    destroySession(token) {
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    },
  };
}

export const cookieOptions = (secure) => ({ httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MS });

/** Reads one cookie from a raw Cookie header (used for WebSocket handshakes). */
export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
