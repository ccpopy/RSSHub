import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id';

import { config } from '@/config';
import cache from '@/utils/cache';

const CACHE_KEY = 'twitter:x-client-transaction:v2';
type TransactionKeys = { key: string; animationKey: string };
let keysPromise: Promise<TransactionKeys> | undefined;

const getClientTransactionKeys = async (refresh = false): Promise<TransactionKeys> => {
    if (!refresh) {
        const cached = await cache.get(CACHE_KEY, false);
        if (cached) {
            try {
                const keys = JSON.parse(cached) as TransactionKeys;
                if (typeof keys.key === 'string' && keys.key && typeof keys.animationKey === 'string' && keys.animationKey) {
                    return keys;
                }
            } catch {
                // Rebuild invalid cached material from the current X client.
            }
        }
    }
    if (!keysPromise) {
        keysPromise = (async () => {
            try {
                const document = await fetchXDocument();
                const { key, animationKey } = (await ClientTransaction.create(document)) as unknown as TransactionKeys;
                const keys = { key, animationKey };
                // These materials rotate with X deployments, independently of the query IDs.
                await cache.set(CACHE_KEY, JSON.stringify(keys), Math.min(config.cache.contentExpire, 900));
                return keys;
            } finally {
                keysPromise = undefined;
            }
        })();
    }
    return keysPromise;
};

export const refreshClientTransactionKeys = () => getClientTransactionKeys(true);

export const getClientTransactionId = async (method: string, path: string) => {
    const { key, animationKey } = await getClientTransactionKeys();
    const clientTransaction = Object.assign(Object.create(ClientTransaction.prototype), { isInitialized: true });
    return clientTransaction.generateTransactionId(method, path, undefined, key, animationKey);
};
