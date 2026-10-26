import { config } from '@/config';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';

const CACHE_KEY = 'twitter:gql-query-ids:v2';

// Hardcoded fallback IDs (last known working values)
export const fallbackIds = {
    UserTweets: 'eoJ5zbv51Z_KVl81v9PmLQ',
    UserByScreenName: 'Gb-d6r0vxPOADdG62OEBpQ',
    HomeTimeline: '3b9_7tltt0hJRef-xm_3sw',
    HomeLatestTimeline: 'm1G65W9TS1-g-AllrKKYDQ',
    UserTweetsAndReplies: 'wc5DRl4VaW5lSqJ8YbftZQ',
    UserMedia: '2DC9TKrcUzwGC_QskSVl5w',
    UserByRestId: 'xvmVfRLmnr1alc5f2dib0Q',
    SearchTimeline: 'BGd0T_j7oVwlW5U79tO_0A',
    ListLatestTweetsTimeline: 'jW040BLUjh8X6Tw2ODQufA',
    TweetDetail: '559hs_YZNV4IgA3Z6zIIuw',
    AudioSpaceById: 'ipEqgz4P_bZCGY3fBnfsxQ',
};

const operationNames = Object.keys(fallbackIds);

interface InternalApiDocument {
    graphql?: Record<string, { queryId?: string } | undefined>;
}

export function extractQueryIds(source: string): Record<string, string> {
    const ids: Record<string, string> = {};
    for (const match of source.matchAll(/queryId:\s*"([\w-]+)",\s*operationName:\s*"(\w+)"/g)) {
        if (operationNames.includes(match[2])) {
            ids[match[2]] = match[1];
        }
    }
    return ids;
}

async function fetchCurrentQueryIds(): Promise<Record<string, string>> {
    // The logged-out home page uses a different app; /i/jf/ still serves the GraphQL client.
    const html = await ofetch('https://x.com/i/jf/', { responseType: 'text', timeout: 10000, retry: 0 });
    const bundleUrl = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.[\w-]+\.js/)?.[0];
    if (!bundleUrl) {
        throw new Error('Twitter GraphQL client bundle was not found');
    }
    const source = await ofetch(bundleUrl, { responseType: 'text', timeout: 10000, retry: 0 });
    const ids = extractQueryIds(source);
    if (Object.keys(ids).length === 0) {
        throw new Error('Twitter GraphQL client did not contain query IDs');
    }
    return ids;
}

async function fetchDocumentQueryIds(): Promise<Record<string, string>> {
    const api = await ofetch<InternalApiDocument>('https://cdn.jsdelivr.net/gh/fa0311/TwitterInternalAPIDocument@master/docs/json/API.json', { timeout: 10000, retry: 0 });

    const ids: Record<string, string> = {};
    for (const name of operationNames) {
        const queryId = api?.graphql?.[name]?.queryId;
        if (typeof queryId === 'string' && /^[\w-]+$/.test(queryId)) {
            ids[name] = queryId;
        }
    }
    return ids;
}

let resolvePromise: Promise<Record<string, string>> | null = null;

export async function resolveQueryIds(refresh = false): Promise<Record<string, string>> {
    // Check cache first
    const cached = !refresh && (await cache.get(CACHE_KEY, false));
    if (cached) {
        try {
            const parsed: Record<string, string> = JSON.parse(cached);
            if (Object.keys(parsed).length > 0) {
                logger.debug('twitter gql-id-resolver: using cached query IDs');
                return { ...fallbackIds, ...parsed };
            }
        } catch {
            // ignore parse error
        }
    }

    // Deduplicate concurrent requests
    if (!resolvePromise) {
        resolvePromise = (async () => {
            try {
                logger.info('twitter gql-id-resolver: fetching current query IDs from X');
                let ids: Record<string, string>;
                try {
                    ids = await fetchCurrentQueryIds();
                    if (operationNames.some((name) => !Object.hasOwn(ids, name))) {
                        // Some operations live in lazy chunks. Retain the document lookup for those.
                        try {
                            ids = { ...(await fetchDocumentQueryIds()), ...ids };
                        } catch {
                            logger.warn('twitter gql-id-resolver: API document unavailable for missing operations');
                        }
                    }
                } catch {
                    logger.warn('twitter gql-id-resolver: current X bundle unavailable, trying API document');
                    ids = await fetchDocumentQueryIds();
                }

                if (Object.keys(ids).length > 0) {
                    await cache.set(CACHE_KEY, JSON.stringify(ids), Math.min(config.cache.contentExpire, 3600));
                    const found = operationNames.filter((name) => ids[name]);
                    const missing = operationNames.filter((name) => !Object.hasOwn(ids, name));
                    logger.debug(`twitter gql-id-resolver: resolved ${found.length}/${operationNames.length} query IDs. Missing: ${missing.join(', ') || 'none'}`);
                } else {
                    logger.warn('twitter gql-id-resolver: failed to extract any query IDs, using fallback');
                }

                return ids;
            } catch (error) {
                logger.warn(`twitter gql-id-resolver: error fetching query IDs: ${error}. Using fallback.`);
                return {};
            } finally {
                resolvePromise = null;
            }
        })();
    }

    const ids = await resolvePromise;
    return { ...fallbackIds, ...ids };
}

export function buildGqlMap(queryIds: Record<string, string>) {
    const map: Record<string, string> = {};
    for (const name of operationNames) {
        const id = queryIds[name] || fallbackIds[name];
        map[name] = `/graphql/${id}/${name}`;
    }
    return map;
}
