import { asMockedFunction } from '@-xun/jest-types';
import limitRequest from '@-xun/next-adhesive/limit-request';
import { withMiddleware } from '@-xun/next-api-glue';
import { isclientRateLimited } from '@-xun/next-limit';
import { testApiHandler } from 'next-test-api-route-handler';
import { mockEnvFactory, noopHandler, wrapHandler } from 'testverse/setup';

jest.mock('@-xun/next-limit');

const withMockedEnv = mockEnvFactory({ NODE_ENV: 'test' });
const mockisclientRateLimited = asMockedFunction(isclientRateLimited);

beforeEach(() => {
  mockisclientRateLimited.mockReturnValue(
    Promise.resolve({ isLimited: false, retryAfter: 0 })
  );
});

it('rate limits requests according to backend determination', async () => {
  expect.hasAssertions();

  await testApiHandler({
    pagesHandler: wrapHandler(
      withMiddleware(noopHandler, {
        descriptor: '/fake',
        use: [limitRequest]
      })
    ),
    test: async ({ fetch }) => {
      await withMockedEnv(
        async () => {
          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: false, retryAfter: 0 })
          );

          await expect(
            fetch().then(async (r) => [r.status, await r.json()])
          ).resolves.toStrictEqual([200, {}]);

          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: true, retryAfter: 100 })
          );

          await expect(
            fetch().then(async (r) => [r.status, await r.json()])
          ).resolves.toStrictEqual([
            429,
            expect.objectContaining({
              retryAfter: 100
            })
          ]);
        },
        { IGNORE_RATE_LIMITS: 'false' }
      );
    }
  });
});

it('does not rate limit requests when ignoring rate limits', async () => {
  expect.hasAssertions();

  await testApiHandler({
    pagesHandler: wrapHandler(
      withMiddleware(noopHandler, {
        descriptor: '/fake',
        use: [limitRequest]
      })
    ),
    test: async ({ fetch }) => {
      await withMockedEnv(
        async () => {
          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: false, retryAfter: 0 })
          );

          await expect(
            fetch().then(async (r) => [r.status, await r.json()])
          ).resolves.toStrictEqual([200, {}]);

          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: true, retryAfter: 100 })
          );

          await expect(
            fetch().then(async (r) => [r.status, await r.json()])
          ).resolves.toStrictEqual([200, {}]);
        },
        { IGNORE_RATE_LIMITS: 'true' }
      );
    }
  });
});

it('treats otherwise valid requests as unauthenticatable only when locking out all clients', async () => {
  expect.hasAssertions();

  await testApiHandler({
    pagesHandler: wrapHandler(
      withMiddleware(noopHandler, {
        descriptor: '/fake',
        use: [limitRequest]
      })
    ),
    test: async ({ fetch }) => {
      await withMockedEnv(
        async () => {
          const res = await fetch();
          expect(res.status).toBe(403);
        },
        {
          LOCKOUT_ALL_CLIENTS: 'true'
        }
      );

      await withMockedEnv(async () => expect((await fetch()).status).toBe(200), {
        LOCKOUT_ALL_CLIENTS: 'false'
      });
    }
  });
});

it('includes retry-after value in header (s) and in response JSON (ms)', async () => {
  expect.hasAssertions();

  await testApiHandler({
    pagesHandler: wrapHandler(
      withMiddleware(noopHandler, {
        descriptor: '/fake',
        use: [limitRequest]
      })
    ),
    test: async ({ fetch }) => {
      await withMockedEnv(
        async () => {
          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: false, retryAfter: 0 })
          );

          await expect(
            fetch().then(async (r) => [r.headers.get('retry-after'), await r.json()])
          ).resolves.toStrictEqual([null, {}]);

          void mockisclientRateLimited.mockReturnValue(
            Promise.resolve({ isLimited: true, retryAfter: 12_344 })
          );

          await expect(
            fetch().then(async (r) => [r.headers.get('retry-after'), await r.json()])
          ).resolves.toStrictEqual([
            '13',
            expect.objectContaining({ retryAfter: 12_344 })
          ]);
        },
        { IGNORE_RATE_LIMITS: 'false' }
      );
    }
  });
});
