import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import { cacheService } from "./cacheService";

const credential = new DefaultAzureCredential();
const client = new SecretClient(process.env.KEY_VAULT_URL!, credential);

export async function putValueInKeyVault(
  secretName: string,
  secretValue: string
): Promise<string> {
  try {
    const result = await client.setSecret(secretName, secretValue);
    await cacheService.set(secretName, secretValue, { ttl: 86400 });
    return result.name || '';
  } catch (error) {
    throw error;
  }
}

export async function getValueFromKeyVault(
  secretName: string,
): Promise<string> {
  try {

    const cachedSecret = await cacheService.get<string>(secretName);
    if (cachedSecret) {
      return cachedSecret;
    }
    const result = await client.getSecret(secretName);
    const value = result.value || '';
    if (value) {
      await cacheService.set(secretName, value, { ttl: 86400 });
    }
    return value;
  } catch (error) {
    console.log("error", error)
    throw error;
  }
} 