import { WithLogger } from './sdk-logging'

/**
 * Base error class for all errors thrown by the Parallel SDK and its utilities
 */
export class ParallelError extends Error {}

/**
 * Wraps a method in a try/catch block and throws a new error with the cause if an error is thrown
 * @note The method must be a class method and the class must be a class that implements WithLogger
 * @param errorConstructor - The constructor to use for the error
 * @returns The wrapped method
 */
export function WrapErrorsIn(
  errorConstructor: new (
    message: string,
    options?: { cause?: unknown }
  ) => Error
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value
    descriptor.value = function (this: WithLogger, ...args: any[]) {
      try {
        const result = originalMethod.apply(this, args)
        if (result instanceof Promise) {
          return result.catch((err) => {
            if (err instanceof ParallelError) {
              this.logger?.error('Parallel: ' + err.message, { error: err })
              throw err
            }
            if (err instanceof Error) {
              this.logger?.error('Parallel: ' + err.message, { error: err })
              throw new errorConstructor(err.message, { cause: err })
            }
            this.logger?.error('Parallel: Unexpected error occurred', {
              error: err,
            })
            throw new errorConstructor('Unexpected error occurred', {
              cause: err,
            })
          })
        }
        return result
      } catch (err) {
        if (err instanceof ParallelError) {
          this.logger?.error('Parallel: ' + err.message, { error: err })
          throw err
        }
        if (err instanceof Error) {
          this.logger?.error('Parallel: ' + err.message, { error: err })
          throw new errorConstructor(err.message, { cause: err })
        }
        this.logger?.error('Parallel: Unexpected error occurred', {
          error: err,
        })
        throw new errorConstructor('Unexpected error occurred', { cause: err })
      }
    }
    return descriptor
  }
}
