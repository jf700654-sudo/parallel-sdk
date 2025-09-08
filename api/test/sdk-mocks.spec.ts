import { describe, it, expect, vi } from 'vitest'
import { MockParallelForTaskDefinition } from '../sdk-mocks'
import { ParallelWebhookHandler } from '../sdk-webhook'
import { z } from 'zod'
import {
  ParallelTaskDefinition,
  ZodParallelTaskJsonIO,
  ZodParallelTaskMetadata,
} from '../sdk-task-definition'
import { ParallelProcessor } from '../sdk-parallel'
import { ParallelTaskWebhook } from '../sdk-task-webhook'

describe(MockParallelForTaskDefinition.name, () => {
  const webhookHandlerFn = vi.fn()
  const taskDefinition = new ParallelTaskDefinition({
    identifier: 'get-brand-logo',
    input: new ZodParallelTaskJsonIO({
      description: 'brand-url',
      schema: z.object({ url: z.string() }),
    }),
    output: new ZodParallelTaskJsonIO({
      description: 'brand-logo',
      schema: z.object({ logoUrl: z.string() }),
    }),
    defaultProcessor: ParallelProcessor.Base,
    metadata: new ZodParallelTaskMetadata({
      schema: z.object({ foo: z.string() }),
    }),
  })
  const taskWebhook = new ParallelTaskWebhook({
    task: taskDefinition,
    onSuccess: webhookHandlerFn,
  })

  it('should allow you to update the handler', () => {
    // arrange
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 0,
    })
    mockParallel.updateWebhookHandler(
      new ParallelWebhookHandler({ taskWebhooks: [taskWebhook] })
    )
  })

  it('should return a task run not found error if the task run does not exist', async () => {
    // arrange
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 0,
    })

    // act
    const result = await mockParallel.getTaskRun({ path: { run_id: '123' } })

    // assert
    expect(result).toEqual(
      expect.objectContaining({
        data: undefined,
        error: {
          error: {
            message: 'Task run not found',
            ref_id: expect.any(String),
          },
        },
        request: expect.any(Request),
        response: expect.any(Response),
      })
    )
  })

  it('should trigger the webhook handler if provided and requested', async () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [taskWebhook],
    })
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 20,
      webhookHandler,
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
    await taskDefinition.pollForRunOutput(taskRun.run_id, mockParallel, {
      backoffExponent: 1,
      intervalMs: 10,
      timeoutMs: 100,
    })

    // assert
    expect(webhookHandlerFn).toHaveBeenCalledWith(
      {
        logoUrl: 'https://example.com/test',
      },
      {
        created_at: expect.any(String),
        is_active: true,
        metadata: {
          attempt: 1,
          foo: 'bar',
          task_id: 'get-brand-logo',
          webhook_url: 'https://example.com/webhook',
        },
        modified_at: expect.any(String),
        processor: 'base',
        run_id: expect.any(String),
        status: 'completed',
      }
    )
  })

  it('should enable fetching the task run input', async () => {
    // arrange
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 0,
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
    const result = await mockParallel.getTaskRunInput({
      path: { run_id: taskRun.run_id },
    })

    // assert
    expect(result).toEqual(
      expect.objectContaining({
        data: {
          input: { url: 'https://example.com' },
          processor: ParallelProcessor.Base,
          metadata: { foo: 'bar', attempt: 1, task_id: 'get-brand-logo' },
          task_spec: {
            output_schema: taskDefinition.output,
            input_schema: taskDefinition.input,
          },
        },
        error: undefined,
        request: expect.any(Request),
        response: expect.any(Response),
      })
    )
  })

  it('should return error if the task run input is not found', async () => {
    // arrange
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 0,
    })

    // act
    const result = await mockParallel.getTaskRunInput({
      path: { run_id: '123' },
    })

    // assert
    expect(result).toEqual(
      expect.objectContaining({
        data: undefined,
        error: expect.objectContaining({
          error: expect.objectContaining({
            message: 'Task run input not found',
            ref_id: expect.any(String),
          }),
        }),
        request: expect.any(Request),
        response: expect.any(Response),
      })
    )
  })

  it('should return error if the task run result is not found', async () => {
    // arrange
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 0,
    })

    // act
    const result = await mockParallel.getTaskRunResult({
      path: { run_id: '123' },
    })

    // assert
    expect(result).toEqual(
      expect.objectContaining({
        data: undefined,
        error: expect.objectContaining({
          error: expect.objectContaining({
            message: 'Task run result not found',
            ref_id: expect.any(String),
          }),
        }),
        request: expect.any(Request),
        response: expect.any(Response),
      })
    )
  })
})
