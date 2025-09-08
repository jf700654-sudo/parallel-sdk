import { describe, it, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'
import { ParallelError, WrapErrorsIn } from '../sdk-errors'
import { Logger } from '../sdk-logging'

const mockLogger = mock<Logger>()

describe(WrapErrorsIn.name, () => {
  it('should wrap errors in the error constructor provided', () => {
    // arrange
    class TestService {
      logger = mockLogger

      @WrapErrorsIn(ParallelError)
      throwsParallelError() {
        throw new Error('test parallel error')
      }

      @WrapErrorsIn(ParallelError)
      throwsError() {
        throw 'test error'
      }

      @WrapErrorsIn(ParallelError)
      resolves() {
        return 'test success'
      }
    }

    // act
    const managedParallelErrorResult = () =>
      new TestService().throwsParallelError()
    const managedErrorResult = () => new TestService().throwsError()
    const result = new TestService().resolves()

    // assert
    expect(managedParallelErrorResult).toThrow(ParallelError)
    expect(managedErrorResult).toThrow(ParallelError)
    expect(result).toBe('test success')
  })

  it('should wrap errors in promises', async () => {
    // arrange
    class TestService {
      logger = mockLogger

      @WrapErrorsIn(ParallelError)
      async throwsParallelError() {
        return Promise.reject(new Error('test parallel error'))
      }

      @WrapErrorsIn(ParallelError)
      async throwsError() {
        throw 'test error'
      }

      @WrapErrorsIn(ParallelError)
      async resolves() {
        return Promise.resolve('test success')
      }
    }

    // act
    const managedParallelErrorResult = () =>
      new TestService().throwsParallelError()
    const managedErrorResult = () => new TestService().throwsError()
    const result = await new TestService().resolves()

    // assert
    await expect(managedParallelErrorResult).rejects.toThrow(ParallelError)
    await expect(managedErrorResult).rejects.toThrow(ParallelError)
    expect(result).toBe('test success')
  })
})
