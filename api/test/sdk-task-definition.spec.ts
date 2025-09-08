import { describe, it, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'
import { MockParallelForTaskDefinition, ParallelError } from '../sdk'
import { z } from 'zod'
import { Logger } from '../sdk-logging'
import { IParallel, ParallelProcessor } from '../sdk-parallel'
import {
  ParallelTaskDefinition,
  ZodParallelTaskJsonIO,
  ZodParallelTaskMetadata,
} from '../sdk-task-definition'

const mockLogger = mock<Logger>()

describe(ZodParallelTaskJsonIO.name, () => {
  it('should create a json schema from a zod schema', () => {
    // arrange
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    })

    // act
    const parallelTaskJsonIO = new ZodParallelTaskJsonIO({
      description: 'test',
      schema: zodSchema,
    })

    // assert
    expect(parallelTaskJsonIO.jsonSchema).toBeDefined()
    expect(parallelTaskJsonIO.jsonSchema.type).toBe('json')
    expect(parallelTaskJsonIO.jsonSchema.json_schema).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: false,
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    })
  })

  it('should provide a parse function that parses the input provided to it', () => {
    // arrange
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const parallelTaskJsonIO = new ZodParallelTaskJsonIO({
      description: 'test',
      schema: zodSchema,
    })

    // act
    const successResult = parallelTaskJsonIO.parse({ name: 'John', age: 30 })
    const managedFailureResult = () =>
      parallelTaskJsonIO.parse({ name: 'John' })

    // assert
    expect(successResult).toEqual({ name: 'John', age: 30 })
    expect(managedFailureResult).toThrow(ParallelError)
  })
})

describe(ZodParallelTaskMetadata.name, () => {
  it('should create a parse function that parses the input provided to it', () => {
    // arrange
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const parallelTaskMetadata = new ZodParallelTaskMetadata({
      schema: zodSchema,
    })

    // act
    const successResult = parallelTaskMetadata.parse({ name: 'John', age: 30 })
    const managedFailureResult = () =>
      parallelTaskMetadata.parse({ name: 'John' })

    // assert
    expect(successResult).toEqual({ name: 'John', age: 30 })
    expect(managedFailureResult).toThrow(ParallelError)
  })
})

describe(ParallelTaskDefinition.name, () => {
  const input = new ZodParallelTaskJsonIO({
    description: 'url',
    schema: z.object({ url: z.string() }),
  })
  const output = new ZodParallelTaskJsonIO({
    description: 'logo',
    schema: z.object({ logoUrl: z.string() }),
  })
  const metadata = new ZodParallelTaskMetadata({
    schema: z.object({ foo: z.string() }),
  })
  const taskDefinition = new ParallelTaskDefinition({
    identifier: 'get-brand-logo',
    input,
    output,
    metadata,
    defaultProcessor: ParallelProcessor.Base,
    logger: mockLogger,
  })

  it('should provide shape data publicly', () => {
    // assert
    expect(taskDefinition.identifier).toBe('get-brand-logo')
    expect(taskDefinition.input).toEqual(input)
    expect(taskDefinition.output).toEqual(output)
  })

  describe('startRun', () => {
    it('starting a run should call right endpoint based on if webhook provided', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.createTaskRunWithWebhook.mockResolvedValue({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        },
      } as any)
      mockParallel.createTaskRun.mockResolvedValue({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        },
      } as any)

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          webhook: new URL('https://example.com'),
          metadata: { foo: 'bar' },
        },
        mockParallel
      )
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          metadata: { foo: 'bar' },
        },
        mockParallel
      )

      // assert
      expect(mockParallel.createTaskRunWithWebhook).toHaveBeenCalledOnce()
      expect(mockParallel.createTaskRun).toHaveBeenCalledOnce()
    })

    it('should apply the task_id and attempt to the metadata', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.createTaskRun.mockResolvedValue({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        },
      } as any)

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
        },
        mockParallel
      )

      // assert
      expect(mockParallel.createTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            metadata: {
              task_id: 'get-brand-logo',
              attempt: 1,
              foo: 'bar',
            },
          }),
        })
      )
    })

    it('should throw a ParallelError if data is not returned', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.createTaskRun.mockResolvedValue({
        data: undefined,
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.startRun(
          {
            input: { url: 'https://example.com' },
            processor: ParallelProcessor.Base,
            metadata: { foo: 'bar' },
          },
          mockParallel
        )

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if an error is thrown', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.createTaskRunWithWebhook.mockRejectedValue(new Error('test'))

      // act
      const managedFailureResult = () =>
        taskDefinition.startRun(
          {
            input: { url: 'https://example.com' },
            processor: ParallelProcessor.Base,
            metadata: { foo: 'bar' },
          },
          mockParallel
        )

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })
  })

  describe('getRun', () => {
    it('should validate the run metadata', async () => {
      // arrange
      const mockParallel = mock<IParallel>()

      // error if metadata is missing
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: { run_id: '123' },
      } as any)
      const noMetadata = () => taskDefinition.getRun('123', mockParallel)
      await expect(noMetadata).rejects.toThrow(ParallelError)

      // error if metadata is not an object
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: { run_id: '123', metadata: 9 },
      } as any)
      const notAnObject = () => taskDefinition.getRun('123', mockParallel)
      await expect(notAnObject).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: { run_id: '123', metadata: { foo: 'bar' } },
      } as any)
      const invalidMetadata = () => taskDefinition.getRun('123', mockParallel)
      await expect(invalidMetadata).rejects.toThrow(ParallelError)

      // error if task_id is invalid
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: {
          run_id: '123',
          metadata: { task_id: 'not-this-task', foo: 'bar' },
        },
      } as any)
      const invalidTaskId = () => taskDefinition.getRun('123', mockParallel)
      await expect(invalidTaskId).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: { run_id: '123', metadata: { task_id: 'get-brand-logo' } },
      } as any)
      const invalidAttempt = () => taskDefinition.getRun('123', mockParallel)
      await expect(invalidAttempt).rejects.toThrow(ParallelError)

      // returns if valid metadata attached
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        },
      } as any)
      const validMetadata = await taskDefinition.getRun('123', mockParallel)
      expect(validMetadata).toEqual({
        run_id: '123',
        metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
      })
    })

    it('should throw a ParallelError if data is not returned', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRun.mockResolvedValue({
        data: undefined,
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.getRun('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if an error is thrown', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRun.mockRejectedValue(new Error('test'))

      // act
      const managedFailureResult = () =>
        taskDefinition.getRun('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })
  })

  describe('getRunInput', () => {
    it('should validate the run metadata and input', async () => {
      // arrange
      const mockParallel = mock<IParallel>()

      // error if metadata is missing
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: { run_id: '123' },
      } as any)
      const noMetadata = () => taskDefinition.getRunInput('123', mockParallel)
      await expect(noMetadata).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: { run_id: '123', metadata: { foo: 'bar' } },
      } as any)
      const invalidMetadata = () =>
        taskDefinition.getRunInput('123', mockParallel)
      await expect(invalidMetadata).rejects.toThrow(ParallelError)

      // error if task_id is invalid
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: { run_id: '123', metadata: { task_id: 'not-this-task' } },
      } as any)
      const invalidTaskId = () =>
        taskDefinition.getRunInput('123', mockParallel)
      await expect(invalidTaskId).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: { run_id: '123', metadata: { task_id: 'get-brand-logo' } },
      } as any)
      const invalidAttempt = () =>
        taskDefinition.getRunInput('123', mockParallel)
      await expect(invalidAttempt).rejects.toThrow(ParallelError)

      // error if input is invalid
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          input: { foo: 'bar' },
        },
      } as any)
      const invalidInput = () => taskDefinition.getRunInput('123', mockParallel)
      await expect(invalidInput).rejects.toThrow(ParallelError)

      // returns if valid metadata attached and input is valid
      mockParallel.getTaskRunInput.mockResolvedValueOnce({
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          input: { url: 'https://example.com' },
        },
      } as any)
      const validMetadata = await taskDefinition.getRunInput(
        '123',
        mockParallel
      )
      expect(validMetadata).toEqual({ url: 'https://example.com' })
    })

    it('should throw a ParallelError if data is not returned', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunInput.mockResolvedValue({
        data: undefined,
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunInput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if an error is thrown', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunInput.mockRejectedValue(new Error('test'))

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunInput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })
  })

  describe('getRunOutput', () => {
    it('should validate the run metadata and output', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      // error if metadata is missing
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: { run: { run_id: '123' } },
      } as any)
      const noMetadata = () => taskDefinition.getRunOutput('123', mockParallel)
      await expect(noMetadata).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: { run: { run_id: '123', metadata: { foo: 'bar' } } },
      } as any)
      const invalidMetadata = () =>
        taskDefinition.getRunOutput('123', mockParallel)
      await expect(invalidMetadata).rejects.toThrow(ParallelError)

      // error if task_id is invalid
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: { run_id: '123', metadata: { task_id: 'not-this-task' } },
        },
      } as any)
      const invalidTaskId = () =>
        taskDefinition.getRunOutput('123', mockParallel)
      await expect(invalidTaskId).rejects.toThrow(ParallelError)

      // error if metadata is invalid
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: { run_id: '123', metadata: { task_id: 'get-brand-logo' } },
        },
      } as any)
      const invalidAttempt = () =>
        taskDefinition.getRunOutput('123', mockParallel)
      await expect(invalidAttempt).rejects.toThrow(ParallelError)

      // returns if valid metadata attached
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: {
            run_id: '123',
            metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          },
          output: {
            type: 'json',
            content: { logoUrl: 'https://example.com' },
          },
        },
      } as any)
      const validMetadata = await taskDefinition.getRunOutput(
        '123',
        mockParallel
      )
      expect(validMetadata).toEqual({ logoUrl: 'https://example.com' })
    })

    it('should throw a ParallelError if output is not json', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: {
            run_id: '123',
            metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          },
          output: { type: 'text', content: 'not json' },
        },
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunOutput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if data is not returned', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunResult.mockResolvedValue({
        data: undefined,
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunOutput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if output does not match the output schema', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: {
            run_id: '123',
            metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          },
          output: { type: 'json', content: { foo: 'not-a-url' } },
        },
      } as any)

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunOutput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if an error is thrown', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      mockParallel.getTaskRunResult.mockRejectedValue(new Error('test'))

      // act
      const managedFailureResult = () =>
        taskDefinition.getRunOutput('123', mockParallel)

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })
  })

  describe('pollForRunResult', () => {
    it('should poll for the run result', async () => {
      // arrange
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com' }),
        successLikelihood: 1,
        timeToResolveMs: 30,
      })

      // act
      const taskRun = await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )
      const result = await taskDefinition.pollForRunOutput(
        taskRun.run_id,
        mockParallel,
        { timeoutMs: 100, intervalMs: 10, backoffExponent: 1 }
      )

      // assert
      expect(result).toEqual({ logoUrl: 'https://example.com' })
    })

    it('should throw a ParallelError if the run fails', async () => {
      // arrange
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com' }),
        successLikelihood: 0,
        timeToResolveMs: 30,
      })

      // act
      const taskRun = await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
        },
        mockParallel
      )
      const managedFailureResult = () =>
        taskDefinition.pollForRunOutput(taskRun.run_id, mockParallel, {
          timeoutMs: 100,
          intervalMs: 10,
          backoffExponent: 1,
        })

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })

    it('should throw a ParallelError if the run times out', async () => {
      // arrange
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com' }),
        successLikelihood: 1,
        timeToResolveMs: 30,
      })

      // act
      const taskRun = await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
        },
        mockParallel
      )
      const managedFailureResult = () =>
        taskDefinition.pollForRunOutput(taskRun.run_id, mockParallel, {
          timeoutMs: 15,
          intervalMs: 5,
          backoffExponent: 1,
        })

      // assert
      await expect(managedFailureResult).rejects.toThrow(ParallelError)
    })
  })
})
