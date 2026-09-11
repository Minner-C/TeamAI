import crypto from "node:crypto";

const b64u = (buf: Buffer) =>
  buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const fromB64u = (s: string) =>
  Buffer.from(s.replaceAll("-", "+").replaceAll("_", "/"), "base64");

export function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export interface TokenPayload {
  uid: string;
  exp: number;
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = b64u(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64u(body).toString()) as TokenPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function encKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "teamai-enc-v1", 32);
}

export function encryptText(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decryptText(enc: string, secret: string): string {
  const [ivB, tagB, dataB] = enc.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(secret), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

export function generateVirtualKey(): string {
  return `tk-${b64u(crypto.randomBytes(24))}`;
}
