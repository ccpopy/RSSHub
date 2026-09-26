import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id';

vi.mock('x-client-transaction-id', () => ({ ClientTransaction: { create: vi.fn() }, fetchXDocument: vi.fn() }));

const generateTransactionId = vi.fn();

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.mocked(fetchXDocument).mockResolvedValue({} as Document);
    vi.mocked(ClientTransaction.create).mockResolvedValue({ generateTransactionId } as unknown as ClientTransaction);
    generateTransactionId.mockResolvedValueOnce('first-id').mockResolvedValue('next-id');
});

afterEach(() => vi.restoreAllMocks());

describe('Twitter client transaction IDs', () => {
    it('shares initialization across concurrent requests but generates a fresh ID for each path', async () => {
        const { getClientTransactionId } = await import('../lib/routes/twitter/api/web-api/client-transaction');
        expect(await Promise.all([getClientTransactionId('GET', '/i/api/graphql/current-id/UserTweetsAndReplies'), getClientTransactionId('GET', '/i/api/graphql/search-id/SearchTimeline')])).toEqual(['first-id', 'next-id']);
        expect(fetchXDocument).toHaveBeenCalledTimes(1);
        expect(ClientTransaction.create).toHaveBeenCalledTimes(1);
        expect(generateTransactionId).toHaveBeenNthCalledWith(1, 'GET', '/i/api/graphql/current-id/UserTweetsAndReplies');
        expect(generateTransactionId).toHaveBeenNthCalledWith(2, 'GET', '/i/api/graphql/search-id/SearchTimeline');
    });

    it('refreshes the web app data after an hour in a long-lived instance', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(0);
        const { getClientTransactionId } = await import('../lib/routes/twitter/api/web-api/client-transaction');
        await getClientTransactionId('GET', '/first');
        now.mockReturnValue(3_599_999);
        await getClientTransactionId('GET', '/second');
        expect(fetchXDocument).toHaveBeenCalledTimes(1);
        now.mockReturnValue(3_600_000);
        await getClientTransactionId('GET', '/third');
        expect(fetchXDocument).toHaveBeenCalledTimes(2);
    });

    it('surfaces initialization failures and retries initialization on the next request', async () => {
        vi.mocked(fetchXDocument).mockRejectedValueOnce(new Error('App shell unavailable'));
        const { getClientTransactionId } = await import('../lib/routes/twitter/api/web-api/client-transaction');
        await expect(getClientTransactionId('GET', '/first')).rejects.toThrow('Twitter client transaction ID generation failed');
        await expect(getClientTransactionId('GET', '/second')).resolves.toBe('first-id');
        expect(fetchXDocument).toHaveBeenCalledTimes(2);
    });

    it('discards an unusable client after generation fails', async () => {
        generateTransactionId.mockReset().mockRejectedValueOnce(new Error('Invalid app data')).mockResolvedValueOnce('recovered-id');
        const { getClientTransactionId } = await import('../lib/routes/twitter/api/web-api/client-transaction');
        await expect(getClientTransactionId('GET', '/first')).rejects.toThrow('Twitter client transaction ID generation failed');
        await expect(getClientTransactionId('GET', '/second')).resolves.toBe('recovered-id');
        expect(ClientTransaction.create).toHaveBeenCalledTimes(2);
    });
});
