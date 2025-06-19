import { getValueFromKeyVault } from "../services/keyVault";

export const getEncryptionSecrets = async () => {
    const featchedValue = await getValueFromKeyVault(process.env.OPS360_IAM_SALT_NONCE!);
    const cleanedValue = featchedValue.replace(/^'|'$/g, '');
    const encryptionPassword = await getValueFromKeyVault(process.env.ENCRYPTION_SECRET!);
    const parsedValue = JSON.parse(cleanedValue);
    const {salt, nonce} = parsedValue;
    return {salt, nonce, encryptionPassword}
}

export const getEncryptionSecretsByTenantId = async (tenantId: string) => {
    try{
        const featchedValue = await getValueFromKeyVault(`tenant-${tenantId}-salt-nonce`);
        const cleanedValue = featchedValue.replace(/^'|'$/g, '');
        const encryptionPassword = await getValueFromKeyVault(process.env.ENCRYPTION_SECRET!);
        const parsedValue = JSON.parse(cleanedValue);
        const {salt, nonce} = parsedValue;
        return {salt, nonce, encryptionPassword}
    }
    catch(error){
        console.log(error);
        return null;
    }
} 