import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id';

const maxClientAge = 60 * 60 * 1000;
let clientPromise: Promise<ClientTransaction> | undefined;
let clientCreatedAt = 0;

const createClient = async () => ClientTransaction.create(await fetchXDocument());

export const getClientTransactionId = async (method: string, path: string) => {
    // Reuse the app data, but sign every request using its current GraphQL path.
    if (!clientPromise || Date.now() - clientCreatedAt >= maxClientAge) {
        clientCreatedAt = Date.now();
        clientPromise = createClient();
    }
    const pendingClient = clientPromise;
    try {
        const client = await pendingClient;
        return await client.generateTransactionId(method, path);
    } catch (error) {
        // A failed initialization must not poison subsequent requests.
        if (clientPromise === pendingClient) {
            clientPromise = undefined;
        }
        throw new Error('Twitter client transaction ID generation failed', { cause: error });
    }
};
