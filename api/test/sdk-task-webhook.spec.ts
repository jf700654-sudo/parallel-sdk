import { describe, it, expect, afterEach, vi } from 'vitest'
import { mock } from 'vitest-mock-extended'
import {
  MockParallelForTaskDefinition,
  ParallelError,
  ParallelTaskRunStatusWebhookEvent,
  ParallelWebhookHandler,
  TaskRun,
} from '../sdk'
import { z } from 'zod'
import { Logger } from '../sdk-logging'
import { IParallel, ParallelProcessor } from '../sdk-parallel'
import {
  ParallelTaskDefinition,
  ZodParallelTaskJsonIO,
  ZodParallelTaskMetadata,
} from '../sdk-task-definition'
import { ParallelTaskWebhook } from '../sdk-task-webhook'

const mockLogger = mock<Logger>()

describe(ParallelTaskWebhook.name, () => {
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
  const onSuccess = vi.fn()
  const onFailure = vi.fn()
  const taskDefinition = new ParallelTaskDefinition({
    identifier: 'get-brand-logo',
    input,
    output,
    metadata,
    defaultProcessor: ParallelProcessor.Base,
    logger: mockLogger,
  })
  const taskWebhook = new ParallelTaskWebhook({
    task: taskDefinition,
    onSuccess,
    onFailure,
  })

  describe('webhookOptions', () => {
    it('should void if no webhook.onSuccess is provided', async () => {
      // arrange
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({ task: taskDefinition })
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
        successLikelihood: 1,
        timeToResolveMs: 0,
      })

      const taskRun = await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
        },
        mockParallel
      )
      await taskWebhook.webhook(
        {
          data: {
            run_id: taskRun.run_id,
            metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
            status: 'completed',
            is_active: true,
            processor: ParallelProcessor.Base,
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
          type: 'task_run.status',
        },
        mockParallel
      )
    })
    it("shouldn't retry if no retries specified", async () => {
      const onSuccess = vi.fn()
      const onFailure = vi.fn()
      const retryForOutput = vi.fn()
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({
        task: taskDefinition,
        outputIsFailure: retryForOutput,
        onSuccess,
        onFailure,
      })
      const webhookHandler = new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook],
        logger: mockLogger,
      })
      retryForOutput.mockResolvedValue(true)
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
        successLikelihood: 1,
        timeToResolveMs: 20,
        webhookHandler,
      })

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )

      // assert
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(retryForOutput).toHaveBeenCalledTimes(1)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledTimes(1)
    })

    it("shouldn't retry if zero retries specified", async () => {
      const onSuccess = vi.fn()
      const onFailure = vi.fn()
      const retryForOutput = vi.fn()
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({
        task: taskDefinition,
        outputIsFailure: retryForOutput,
        onSuccess,
        onFailure,
        retries: 0,
      })
      const webhookHandler = new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook],
        logger: mockLogger,
      })
      retryForOutput.mockResolvedValue(true)
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
        successLikelihood: 1,
        timeToResolveMs: 20,
        webhookHandler,
      })

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )

      // assert
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(retryForOutput).toHaveBeenCalledTimes(1)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledTimes(1)
    })

    it('should retry the task run if the output fails for x retries', async () => {
      const onSuccess = vi.fn()
      const retryForOutput = vi.fn()
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({
        task: taskDefinition,
        onSuccess,
        outputIsFailure: retryForOutput,
        retries: 3,
      })
      const webhookHandler = new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook],
        logger: mockLogger,
      })
      retryForOutput.mockResolvedValue(true)
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
        successLikelihood: 1,
        timeToResolveMs: 20,
        webhookHandler,
      })

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )

      // assert
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(retryForOutput).toHaveBeenCalledTimes(3)
    })

    it('should retry for each processor', async () => {
      const onSuccess = vi.fn()
      const retryForOutput = vi.fn()
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({
        task: taskDefinition,
        onSuccess,
        outputIsFailure: retryForOutput,
        retries: {
          [ParallelProcessor.Base]: 3,
          [ParallelProcessor.Core]: 2,
          [ParallelProcessor.Pro]: 1,
          [ParallelProcessor.Ultra]: 1,
        },
      })
      const webhookHandler = new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook],
        logger: mockLogger,
      })
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(true)
      retryForOutput.mockResolvedValueOnce(false)
      const mockResponse = { logoUrl: 'https://example.com/test' }
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => mockResponse,
        successLikelihood: 1,
        timeToResolveMs: 20,
        webhookHandler,
      })

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )

      // assert
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(retryForOutput).toHaveBeenCalledTimes(7)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(retryForOutput.mock.calls).toEqual([
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Base,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Base,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Base,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Core,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Core,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Pro,
            status: 'completed',
          }),
        ],
        [
          mockResponse,
          expect.objectContaining({
            processor: ParallelProcessor.Ultra,
            status: 'completed',
          }),
        ],
      ])
    })

    it('should retry the task run if the output fails for x retries', async () => {
      const onFailure = vi.fn()
      const taskDefinition = new ParallelTaskDefinition({
        identifier: 'get-brand-logo',
        input,
        output,
        metadata,
        defaultProcessor: ParallelProcessor.Base,
        logger: mockLogger,
      })
      const taskWebhook = new ParallelTaskWebhook({
        task: taskDefinition,
        onFailure,
        retries: 3,
      })
      const webhookHandler = new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook],
        logger: mockLogger,
      })
      const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
        outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
        successLikelihood: 0,
        timeToResolveMs: 20,
        webhookHandler,
      })

      // act
      await taskDefinition.startRun(
        {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar' },
          webhook: new URL('https://example.com/webhook'),
        },
        mockParallel
      )

      // assert
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(onFailure).toHaveBeenCalledTimes(1)
    })
  })

  describe('webhook', () => {
    afterEach(() => {
      onSuccess.mockReset()
      onFailure.mockReset()
    })

    it('should call the webhook handler with the correct output', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      const taskRun: TaskRun = {
        run_id: '123',
        metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        status: 'completed',
        is_active: true,
        processor: ParallelProcessor.Base,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      }
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: taskRun,
        request: {} as any,
        response: {} as any,
      })
      mockParallel.getTaskRunResult.mockResolvedValueOnce({
        data: {
          run: {
            run_id: '123',
            metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          },
          output: { type: 'json', content: { logoUrl: 'https://example.com' } },
        },
      } as any)
      const mockEvent: ParallelTaskRunStatusWebhookEvent = {
        type: 'task_run.status',
        timestamp: new Date().toISOString(),
        data: {
          run_id: '123',
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          status: 'completed',
          is_active: true,
          processor: ParallelProcessor.Base,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        },
      }

      // act
      await taskWebhook.webhook(mockEvent, mockParallel)

      // assert
      expect(mockParallel.getTaskRunResult).toHaveBeenCalledWith(
        expect.objectContaining({ path: { run_id: '123' } })
      )
      expect(onSuccess).toHaveBeenCalledWith(
        {
          logoUrl: 'https://example.com',
        },
        expect.objectContaining({
          created_at: expect.any(String),
          is_active: true,
          metadata: {
            attempt: 1,
            foo: 'bar',
            task_id: 'get-brand-logo',
          },
          modified_at: expect.any(String),
          processor: 'base',
          run_id: expect.any(String),
          status: 'completed',
        })
      )
      expect(onFailure).not.toHaveBeenCalled()
    })

    it('should call the onFailure handler if the task run fails', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      const taskRun: TaskRun = {
        run_id: '123',
        metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        status: 'failed',
        is_active: true,
        processor: ParallelProcessor.Base,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      }
      mockParallel.getTaskRun.mockResolvedValueOnce({
        data: taskRun,
        request: {} as any,
        response: {} as any,
      })
      const mockEvent: ParallelTaskRunStatusWebhookEvent = {
        type: 'task_run.status',
        timestamp: new Date().toISOString(),
        data: taskRun,
      }

      // act
      await taskWebhook.webhook(mockEvent, mockParallel)

      // assert
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          created_at: expect.any(String),
          is_active: true,
          metadata: {
            attempt: 1,
            foo: 'bar',
            task_id: 'get-brand-logo',
            webhook_url: undefined,
          },
          modified_at: expect.any(String),
          processor: 'base',
          run_id: expect.any(String),
          status: 'failed',
        })
      )
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('should not call the webhook handler if the task is not the correct task', async () => {
      // arrange
      const mockParallel = mock<IParallel>()
      const mockEvent: ParallelTaskRunStatusWebhookEvent = {
        type: 'task_run.status',
        timestamp: new Date().toISOString(),
        data: {
          run_id: '123',
          metadata: { task_id: 'not-this-task', attempt: 1, foo: 'bar' },
          status: 'completed',
          is_active: true,
          processor: ParallelProcessor.Base,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        },
      }

      // act
      await taskWebhook.webhook(mockEvent, mockParallel)

      // assert
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onFailure).not.toHaveBeenCalled()
    })
  })

  it('should throw a ParallelError if the event is invalid', async () => {
    // arrange
    const mockParallel = mock<IParallel>()
    const mockEvent = {
      type: 'task_run.status',
      timestamp: new Date().toISOString(),
    } as any

    // act
    const managedFailureResult = () =>
      taskWebhook.webhook(mockEvent, mockParallel)

    // assert
    await expect(managedFailureResult).rejects.toThrow(ParallelError)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })
})
