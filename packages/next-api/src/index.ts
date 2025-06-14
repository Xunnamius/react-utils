import { createDebugLogger } from 'rejoinder';
import { sendNotImplemented } from '@-xun/next-api-respond';
import { toss } from 'toss-expression';

import type { NoInfer } from '@-xun/types';
import type { Debugger } from 'rejoinder';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const debug = createDebugLogger('next-api-glue:runtime');

/**
 * The shape of a custom middleware function.
 */
export type Middleware<
  Options extends Record<string, unknown> = Record<string, unknown>
> = (
  req: NextApiRequest,
  res: NextApiResponse,
  context: MiddlewareContext<Options>
) => unknown;

/**
 * The shape of a middleware context object, potentially customized with
 * additional middleware-specific options.
 *
 * Note that type checking cannot enforce that certain options are passed in the
 * case that an options argument is omitted when calling `withMiddleware`. So,
 * to be safe, all custom middleware context options should be declared as
 * optional (i.e. `{ myOpt?: aType }` instead of `{ myOpt: aType })`.
 *
 * Middleware should default to the most restrictive configuration possible if
 * its respective options are missing.
 */
export type MiddlewareContext<
  Options extends Record<string, unknown> = Record<string, unknown>
> = {
  /**
   * Contains middleware use chain control functions and various metadata.
   */
  runtime: {
    /**
     * Metadata describing the current endpoint.
     */
    endpoint: {
      /**
       * A parameterized path string in the form of a URI path corresponding to
       * the current endpoint. For example: `/my-endpoint/:some_id`.
       */
      descriptor?: string;
    };
    /**
     * Call the next middleware function in the use chain. If not called
     * explicitly before a middleware function resolves, and `done()` was also
     * not called, `next()` will be called automatically. This means calling
     * `next()` in a middleware function is entirely optional.
     */
    readonly next: () => Promise<void>;
    /**
     * Stop calling middleware functions, effectively aborting execution of the
     * use chain. If `response.end` hasn't been called before calling this
     * function, it will be called automatically. On abort, the handler will
     * also be skipped.
     */
    readonly done: () => void;
    /**
     * For middleware run via `useOnError`, the `error` property will contain
     * the thrown error object.
     */
    readonly error: unknown;
  };
  /**
   * Options expected by middleware functions at runtime.
   */
  options: Options & {
    /**
     * If `true`, `context.runtime.done` is called whenever `response.end` is
     * called before the middleware chain completes execution. If `false`, the
     * entire primary middleware chain will always run to completion, even if
     * the response has already been sent before it completes.
     *
     * @default true
     */
    callDoneOnEnd: boolean;
  };
};

/**
 * Generic middleware runner. Decorates a request handler.
 *
 * Passing `undefined` as `handler` or not calling `res.end()` (and not sending
 * headers) in your handler or use chain will trigger an `HTTP 501 Not
 * Implemented` response. This can be used to to stub out endpoints and their
 * middleware for later implementation.
 */
export function withMiddleware<
  Options extends Record<string, unknown> = Record<string, unknown>
>(
  pagesHandler: NextApiHandler | undefined,
  {
    descriptor,
    use,
    useOnError,
    options
  }: {
    descriptor: MiddlewareContext['runtime']['endpoint']['descriptor'];
    use: Middleware<NoInfer<Options>>[];
    useOnError?: Middleware<NoInfer<Options>>[];
    options?: Partial<MiddlewareContext<NoInfer<Options>>['options']> & NoInfer<Options>;
  }
) {
  if (!Array.isArray(use)) {
    throw new TypeError('withMiddleware `use` parameter must be an array');
  }

  if (useOnError && !Array.isArray(useOnError)) {
    throw new Error('withMiddleware `useOnError` parameter must be an array');
  }

  return async (req: NextApiRequest, res: NextApiResponse) => {
    /* istanbul ignore next */
    const middlewareContext: MiddlewareContext<NoInfer<Options>> = {
      runtime: {
        endpoint: {
          descriptor
        },
        next: () => toss(new Error('runtime.next was called unexpectedly')),
        done: () => toss(new Error('runtime.done was called unexpectedly')),
        error: undefined
      },
      options: { callDoneOnEnd: true, ...options } as MiddlewareContext<
        NoInfer<Options>
      >['options']
    };

    /**
     * Async middleware chain iteration. Returns `true` if execution was aborted
     * or `false` otherwise.
     */
    const startPullingChain = async (
      chain: IterableIterator<Middleware<NoInfer<Options>>>,
      localDebug: Debugger
    ) => {
      let executionWasAborted = false;
      let executionCompleted = false;
      let ranAtLeastOneMiddleware = false;

      try {
        if (middlewareContext.options.callDoneOnEnd) {
          localDebug(
            'chain will automatically call runtime.done after first call to res.end'
          );

          const send = res.end;
          res.end = ((...args: Parameters<typeof res.end>) => {
            const sent = res.writableEnded || res.headersSent;
            send(...args);

            if (!sent) {
              if (!executionWasAborted && !executionCompleted) {
                localDebug('calling runtime.done after first call to res.end');
                middlewareContext.runtime.done();
              } else {
                localDebug(
                  'NOTICE: skipped calling runtime.done since chain already finished executing'
                );
              }
            }
          }) as typeof res.end;
        } else {
          localDebug('chain will NOT automatically call runtime.done');
        }

        const pullChain = async () => {
          let chainWasPulled = false;
          const { value: currentMiddleware, done } = chain.next();

          // @ts-expect-error: next is readonly to everyone but us
          middlewareContext.runtime.next = async () => {
            if (!executionCompleted) {
              if (executionWasAborted) {
                debug.warn(
                  'runtime.next: chain was aborted; calling runtime.next() at this point is a noop'
                );
              } else {
                chainWasPulled = true;
                localDebug('runtime.next: manually selecting next middleware in chain');
                await pullChain();
              }
            } else {
              debug.warn(
                'runtime.next: chain already finished executing; calling runtime.next() at this point is a noop'
              );
            }
          };

          // @ts-expect-error: done is readonly to everyone but us
          middlewareContext.runtime.done = () => {
            if (!executionCompleted) {
              if (!executionWasAborted) {
                localDebug('runtime.done: aborting middleware execution chain');
                executionWasAborted = true;
              } else {
                debug.warn(
                  'runtime.done: chain already aborted; calling runtime.done() at this point is a noop'
                );
              }
            } else {
              debug.warn(
                'runtime.done: chain already finished executing; calling runtime.done() at this point is a noop'
              );
            }
          };

          if (!done) {
            if (typeof currentMiddleware === 'function') {
              localDebug('executing middleware');
              await currentMiddleware(req, res, middlewareContext);
              ranAtLeastOneMiddleware = true;
            } else {
              debug.warn('skipping execution of non-function item in chain');
            }

            if (executionWasAborted) {
              localDebug('execution chain aborted manually');
            } else if (!chainWasPulled) {
              localDebug('selecting next middleware in chain');
              await pullChain();
            }
          } else {
            localDebug('no more middleware to execute');
            !executionCompleted && localDebug('deactivated runtime control functions');
            executionCompleted = true;
          }
        };

        await pullChain();
        localDebug('stopped middleware execution chain');
        localDebug(
          `at least one middleware executed: ${ranAtLeastOneMiddleware ? 'yes' : 'no'}`
        );

        return executionWasAborted;
      } catch (error) {
        executionWasAborted = true;
        debug.warn('execution chain aborted due to error');
        throw error;
      }
    };

    debug('-- begin --');

    try {
      let primaryChainWasAborted = false;

      try {
        debug('selecting first middleware in primary middleware chain');
        primaryChainWasAborted = await startPullingChain(use[Symbol.iterator](), debug);
      } catch (error) {
        debug('error in primary middleware chain');
        throw error;
      }

      if (typeof pagesHandler === 'function') {
        if (primaryChainWasAborted) {
          debug('not executing handler since primary chain execution was aborted');
        } else {
          debug('executing handler');
          await pagesHandler(req, res);
          debug('finished executing handler');
        }
      } else {
        debug('no handler function available');
      }

      if (!res.writableEnded && !res.headersSent) {
        debug('response was not sent: sending "not implemented" error');
        sendNotImplemented(res);
      }

      debug('-- done --');
    } catch (error) {
      try {
        debug.error('attempting to handle error: %O', error);

        // @ts-expect-error: error is readonly to everyone but us
        middlewareContext.runtime.error = error;

        if (useOnError) {
          try {
            debug.error('selecting first middleware in error handling middleware chain');
            await startPullingChain(useOnError[Symbol.iterator](), debug.error);
          } catch (subError) {
            // ? Error in error handler was unhandled
            debug.error('error in error handling middleware chain: %O', subError);
            debug.error('throwing unhandled error');
            throw subError;
          }
        } else {
          debug.error('no error handling middleware found');
          debug.error('throwing unhandled error');
          throw error;
        }

        // ? Error was unhandled, kick it up to the caller (usually Next itself)
        if (!res.writableEnded && !res.headersSent) {
          debug.error('throwing unhandled error');
          throw error;
        }
      } finally {
        debug('-- done (with errors) --');
      }
    }
  };
}

/**
 * Returns a `withMiddleware` function decorated with a preset configuration.
 * `withMiddleware` optionally accepts its usual parameters, which will be
 * appended onto the arguments to `withMiddlewareFactory` (the "preset
 * parameters"); however, note that passed option keys will overwrite their
 * preset counterparts.
 *
 * Useful when you don't want to repeatedly import, configure, and list a bunch
 * of middleware every time you want to call `withMiddleware`.
 */
export function middlewareFactory<
  Options extends Record<string, unknown> = Record<string, unknown>
>({
  use: defaultUse,
  useOnError: defaultUseOnError,
  options: defaultOptions
}: {
  use: Middleware<NoInfer<Options>>[];
  useOnError?: Middleware<NoInfer<Options>>[];
  options?: Partial<MiddlewareContext<NoInfer<Options>>['options']> & NoInfer<Options>;
}) {
  return <PassedOptions extends Record<string, unknown> = Record<string, unknown>>(
    pagesHandler: NextApiHandler | undefined,
    params: {
      descriptor: MiddlewareContext['runtime']['endpoint']['descriptor'];
      prependUse?: Middleware<NoInfer<Options>>[];
      appendUse?: Middleware<NoInfer<Options>>[];
      prependUseOnError?: Middleware<NoInfer<Options>>[];
      appendUseOnError?: Middleware<NoInfer<Options>>[];
      options?: Partial<MiddlewareContext<NoInfer<Options>>['options']> &
        NoInfer<PassedOptions>;
    }
  ) => {
    const {
      descriptor,
      prependUse,
      appendUse,
      prependUseOnError,
      appendUseOnError,
      options: passedOptions
    } = { ...params };

    return withMiddleware<NoInfer<Options> & NoInfer<PassedOptions>>(pagesHandler, {
      descriptor,
      use: [...(prependUse || []), ...defaultUse, ...(appendUse || [])],
      useOnError: [
        ...(prependUseOnError || []),
        ...(defaultUseOnError || []),
        ...(appendUseOnError || [])
      ],
      options: { ...defaultOptions, ...passedOptions } as Partial<
        MiddlewareContext<NoInfer<Options> & NoInfer<PassedOptions>>['options']
      > &
        NoInfer<Options> &
        NoInfer<PassedOptions>
    });
  };
}
