import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../lib/routes/twitter/api';
import { route } from '../lib/routes/twitter/user';
import type { Data } from '../lib/types';

vi.mock('../lib/routes/twitter/api', () => ({ default: { init: vi.fn(), getUser: vi.fn(), getUserTweets: vi.fn(), getUserTweetsAndReplies: vi.fn() } }));

const ctx = { req: { param: (name: string) => (name === 'id' ? 'example' : 'includeReplies=true') } } as unknown as Parameters<typeof route.handler>[0];
const tweet = {
    id_str: '456',
    full_text: '@someone A reply',
    in_reply_to_screen_name: 'someone',
    created_at: 'Sat, 26 Sep 2026 00:00:00 GMT',
    user: { name: 'Example', screen_name: 'example' },
    entities: { urls: [] },
};

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getUser).mockResolvedValue({ name: 'Example', screen_name: 'example', description: '', profile_image_url: 'https://example.com/avatar.jpg' });
    vi.mocked(api.getUserTweetsAndReplies).mockResolvedValue([structuredClone(tweet)]);
});

describe('Twitter replies route', () => {
    it('includes the author reply in the feed', async () => {
        const feed = (await route.handler(ctx)) as Data;
        expect(feed.item).toHaveLength(1);
        expect(feed.item?.[0].title).toBe('Re @someone A reply');
        expect(feed.item?.[0].link).toBe('https://x.com/example/status/456');
        expect(api.getUserTweets).not.toHaveBeenCalled();
    });

    it('propagates an upstream failure instead of returning a successful empty feed', async () => {
        vi.mocked(api.getUserTweetsAndReplies).mockRejectedValueOnce(new Error('Twitter API error: 404'));
        await expect(route.handler(ctx)).rejects.toThrow('Twitter API error: 404');
    });
});
