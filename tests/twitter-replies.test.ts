import { CookieJar } from 'tough-cookie';
import undici from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../lib/config';
import { getClientTransactionId } from '../lib/routes/twitter/api/web-api/client-transaction';
import { gqlMap } from '../lib/routes/twitter/api/web-api/constants';
import { paginationTweets } from '../lib/routes/twitter/api/web-api/utils';
import cache from '../lib/utils/cache';
import ofetch from '../lib/utils/ofetch';

vi.mock('../lib/config', () => ({ config: { twitter: { authToken: ['test-token'] }, cache: { contentExpire: 3600 } } }));
vi.mock('../lib/utils/cache', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../lib/utils/logger', () => ({ default: { debug: vi.fn() } }));
vi.mock('../lib/utils/ofetch', () => ({ default: vi.fn() }));
vi.mock('../lib/utils/proxy', () => ({ default: {} }));
vi.mock('http-cookie-agent/undici', () => ({ CookieAgent: class {}, cookie: vi.fn() }));
vi.mock('undici', () => ({ default: { fetch: vi.fn() }, ProxyAgent: vi.fn() }));
vi.mock('../lib/routes/twitter/api/web-api/client-transaction', () => ({ getClientTransactionId: vi.fn() }));
vi.mock('../lib/routes/twitter/api/web-api/constants', () => ({
    baseUrl: 'https://x.com/i/api',
    bearerToken: 'test-bearer',
    gqlMap: {
        UserTweets: '/graphql/tweets-id/UserTweets',
        UserTweetsAndReplies: '/graphql/current-id/UserTweetsAndReplies',
        SearchTimeline: '/graphql/search-id/SearchTimeline',
    },
    gqlFeatures: {},
    thirdPartySupportedAPI: ['UserTweetsAndReplies'],
}));

const entries = [{ entryId: 'tweet-123', content: {} }];
const timeline = { instructions: [{ type: 'TimelineAddEntries', entries }] };
const response = { data: { user: { result: { timeline: { timeline } } }, search: timeline } };

beforeEach(() => {
    vi.resetAllMocks();
    config.twitter.thirdPartyApi = undefined;
    const jar = new CookieJar();
    jar.setCookieSync('auth_token=test-token', 'https://x.com');
    jar.setCookieSync('ct0=test-csrf', 'https://x.com');
    vi.mocked(cache.get).mockImplementation((key) => Promise.resolve(key.startsWith('twitter:cookie:') ? JSON.stringify(jar.serializeSync()) : undefined));
    vi.mocked(getClientTransactionId).mockResolvedValue('generated-transaction-id');
    vi.mocked(undici.fetch).mockImplementation(() => Promise.resolve(Response.json(response) as unknown as Awaited<ReturnType<typeof undici.fetch>>));
    vi.mocked(ofetch).mockResolvedValue(response);
});

describe('Twitter replies web requests', () => {
    it.each(['UserTweetsAndReplies', 'SearchTimeline'])('sends a generated transaction ID to %s with the current pathname and preserves authentication', async (endpoint) => {
        const result = await paginationTweets(endpoint, 123, { count: 20 }, endpoint === 'SearchTimeline' ? ['search'] : undefined);
        expect(result).toEqual(entries);
        expect(getClientTransactionId).toHaveBeenCalledExactlyOnceWith('GET', `/i/api${gqlMap[endpoint]}`);
        expect(undici.fetch).toHaveBeenCalledWith(
            expect.stringContaining(`https://x.com/i/api${gqlMap[endpoint]}?`),
            expect.objectContaining({ headers: expect.objectContaining({ 'x-client-transaction-id': 'generated-transaction-id', 'x-csrf-token': 'test-csrf', authorization: 'test-bearer' }) })
        );
    });

    it('keeps ordinary user timelines independent of transaction initialization', async () => {
        await paginationTweets('UserTweets', 123, {});
        expect(getClientTransactionId).not.toHaveBeenCalled();
        expect(vi.mocked(undici.fetch).mock.calls[0][1]?.headers).not.toHaveProperty('x-client-transaction-id');
    });

    it('leaves third-party API requests unchanged', async () => {
        config.twitter.thirdPartyApi = 'https://provider.example';
        expect(await paginationTweets('UserTweetsAndReplies', 123, {})).toEqual(entries);
        expect(ofetch).toHaveBeenCalledTimes(1);
        expect(getClientTransactionId).not.toHaveBeenCalled();
        expect(undici.fetch).not.toHaveBeenCalled();
    });

    it('does not send an unsigned request when transaction generation fails', async () => {
        vi.mocked(getClientTransactionId).mockRejectedValueOnce(new Error('Transaction initialization failed'));
        await expect(paginationTweets('UserTweetsAndReplies', 123, {})).rejects.toThrow('Transaction initialization failed');
        expect(undici.fetch).not.toHaveBeenCalled();
    });
});
