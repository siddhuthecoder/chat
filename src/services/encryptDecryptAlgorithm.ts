import { createHash, randomBytes } from "crypto";
import argon2 from "argon2";
import sodium from "sodium-native";
import { cacheService } from "./cacheService";


const generateSalt = () => randomBytes(16).toString("hex");

// Derive an encryption key using Argon2id
const deriveKey = async (password: string, salt: string): Promise<Buffer> => {

  const cacheKey = `${password}:${salt}`;
  const cached = await cacheService.get<string>(cacheKey);
  if (cached) {
    return Buffer.from(cached, 'base64');
  }
  const key = await argon2.hash(password, {
    type: argon2.argon2id,
    salt: Buffer.from(salt, "hex"),
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    raw: true
  });

  await cacheService.set(cacheKey, key.toString('base64'), { ttl: 86400 });

  return key;
};


const encryptData = async (plaintext: string, key: Buffer) => {
  const nonce = randomBytes(24); // 192-bit nonce
  const message = Buffer.from(plaintext, "utf-8");
  const ciphertext = Buffer.alloc(message.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);

  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext,
    message,
    null,
    null,
    nonce,
    key
  );

  return { ciphertext: ciphertext.toString("hex"), nonce: nonce.toString("hex") };
};

const decryptData = async (ciphertextHex: string, nonceHex: string, key: Buffer) => {
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const nonce = Buffer.from(nonceHex, "hex");
  const message = Buffer.alloc(ciphertext.length - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
  const result: any = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    message,
    null,
    ciphertext,
    null,
    nonce,
    key
  );

  if (result === false) {
    throw new Error("Decryption failed");
  }

  return message.toString("utf-8");
};

const encryptDataWithNonce = async (plaintext: string, salt: string, nonce: string, encryptionPassword: string) => {
  const key = await deriveKey(encryptionPassword, salt);
  const message = Buffer.from(plaintext, "utf-8");
  const ciphertext = Buffer.alloc(message.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);

  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext,
    message,
    null,
    null,
    Buffer.from(nonce, "hex"),
    key
  );

  return ciphertext.toString("hex");
}

const generateCacheKey = (fieldName: string, tenantId: string, docId: string, moduleName: string, updatedAt: Date): string => {
  return [tenantId, moduleName, docId, fieldName, updatedAt?.toISOString()].join(":")
}

const decryptDataWithNonce = async (ciphertextHex: string, nonceHex: string, salt: string, encryptionPassword: string, cacheKey?: string, ttl = 86400) => {

  let cachedData;
  if (cacheKey) {
    cachedData = await cacheService.get(cacheKey)
    if (cachedData) {
      return cachedData;
    }
  }
  const key = await deriveKey(encryptionPassword, salt);
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const nonce = Buffer.from(nonceHex, "hex");
  const message = Buffer.alloc(ciphertext.length - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
  const result: any = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    message,
    null,
    ciphertext,
    null,
    nonce,
    key
  );

  if (result === false) {
    throw new Error("Decryption failed");
  }

  const newCacheData = message.toString("utf-8");
  if (cacheKey) {
    cacheService.set(cacheKey, newCacheData, { ttl })
  }
  return newCacheData;

}



// Invalidate decryption cache for specific patterns
const invalidateDecryptionCache = async (tenantId: string, pattern?: string) => {
  try {
    const searchPattern = pattern || '*';
    const deletedCount = await cacheService.delPattern(searchPattern);
    console.log(`Invalidated ${deletedCount} decryption cache entries for tenant: ${tenantId}`);
    return deletedCount;
  } catch (error) {
    console.error('Error invalidating decryption cache:', error);
    throw error;
  }
};

// Clear all PII cache for a tenant (useful for security incidents)
const clearTenantPIICache = async (tenantId: string) => {
  return await invalidateDecryptionCache(tenantId, '*');
};



const storePII = async (ssn: string, password: string) => {
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const { ciphertext, nonce } = await encryptData(ssn, key);
  return { nonce, salt, ciphertext }
}

export {
  generateSalt,
  deriveKey,
  encryptData,
  decryptData,
  encryptDataWithNonce,
  decryptDataWithNonce,
  invalidateDecryptionCache,
  clearTenantPIICache,
  storePII,
  generateCacheKey
};