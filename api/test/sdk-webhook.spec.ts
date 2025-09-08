import { describe, it, expect, vi } from 'vitest'
import { mock } from 'vitest-mock-extended'
import {
  MockParallelForTaskDefinition,
  ParallelError,
  ParallelWebhookHandler,
} from '../sdk'
import { z } from 'zod'
import { Logger } from '../sdk-logging'
import { IParallel, Parallel, ParallelProcessor } from '../sdk-parallel'
import {
  ParallelTaskDefinition,
  ZodParallelTaskJsonIO,
  ZodParallelTaskMetadata,
} from '../sdk-task-definition'
import { ParallelTaskWebhook } from '../sdk-task-webhook'

const mockLogger = mock<Logger>()

describe(ParallelWebhookHandler.name, () => {
  it('should throw a ParallelError if duplicate identifiers are provided', () => {
    const taskDefinition = new ParallelTaskDefinition({
      identifier: 'get-brand-logo',
      input: new ZodParallelTaskJsonIO({
        description: 'url',
        schema: z.object({ url: z.string() }),
      }),
      output: new ZodParallelTaskJsonIO({
        description: 'logo',
        schema: z.object({ logoUrl: z.string() }),
      }),
      metadata: new ZodParallelTaskMetadata({
        schema: z.object({ foo: z.string() }),
      }),
      defaultProcessor: ParallelProcessor.Base,
      logger: mockLogger,
    })

    const taskWebhook1 = new ParallelTaskWebhook({ task: taskDefinition })
    const taskWebhook2 = new ParallelTaskWebhook({ task: taskDefinition })

    // act
    const managedFailureResult = () =>
      new ParallelWebhookHandler({
        taskWebhooks: [taskWebhook1, taskWebhook2],
        logger: mockLogger,
      })

    // assert
    expect(managedFailureResult).toThrow(ParallelError)
  })

  it('should handle the webhook event', async () => {
    // arrange
    const webhookHandlerFn =
      vi.fn<(output: { logoUrl: string }) => Promise<void> | void>()
    const taskDefinition = new ParallelTaskDefinition({
      identifier: 'get-brand-logo',
      input: new ZodParallelTaskJsonIO({
        description: 'url',
        schema: z.object({ url: z.string() }),
      }),
      output: new ZodParallelTaskJsonIO({
        description: 'logo',
        schema: z.object({ logoUrl: z.string() }),
      }),
      metadata: new ZodParallelTaskMetadata({
        schema: z.object({ foo: z.string() }),
      }),
      defaultProcessor: ParallelProcessor.Base,
      logger: mockLogger,
    })
    const taskWebhook = new ParallelTaskWebhook({
      task: taskDefinition,
      onSuccess: webhookHandlerFn,
    })
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [taskWebhook],
      logger: mockLogger,
    })
    const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
      outputFactory: () => ({ logoUrl: 'https://example.com/test' }),
      successLikelihood: 1,
      timeToResolveMs: 30,
    })

    const taskRun = await taskDefinition.startRun(
      {
        input: { url: 'https://example.com' },
        processor: ParallelProcessor.Base,
        metadata: { foo: 'bar' },
      },
      mockParallel
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    await webhookHandler.handleTaskWebhook(
      {
        type: 'task_run.status',
        timestamp: new Date().toISOString(),
        data: {
          run_id: taskRun.run_id,
          metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
          status: 'completed',
          is_active: true,
          processor: ParallelProcessor.Base,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        },
      },
      mockParallel
    )
    const managedFailureResult = () =>
      webhookHandler.handleTaskWebhook(
        {
          type: 'task_run.status',
          timestamp: new Date().toISOString(),
          data: {
            run_id: '123',
            metadata: {
              task_id: 'not-a-registered-task',
              attempt: 1,
              foo: 'bar',
            },
            status: 'running',
            is_active: true,
            processor: ParallelProcessor.Base,
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
          },
        },
        mockParallel
      )
    expect(webhookHandlerFn).toHaveBeenCalledWith(
      {
        logoUrl: 'https://example.com/test',
      },
      expect.objectContaining({})
    )
    await expect(managedFailureResult()).resolves.toBeUndefined()
  })

  it('should parse the webhook event', () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    // act
    const successResult = webhookHandler.parseWebhookEvent({
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
    })
    const managedFailureResult = () => webhookHandler.parseWebhookEvent({})

    // assert
    expect(successResult).toEqual({
      type: 'task_run.status',
      timestamp: expect.any(String),
      data: {
        run_id: '123',
        metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        status: 'completed',
        is_active: true,
        processor: ParallelProcessor.Base,
        created_at: expect.any(String),
        modified_at: expect.any(String),
      },
    })
    expect(managedFailureResult).toThrow(ParallelError)
  })

  it('should also handle json strings when parsing the webhook event', () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    // act
    const successResult = webhookHandler.parseWebhookEvent(
      JSON.stringify({
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
      })
    )
    const managedFailureResult = () =>
      webhookHandler.parseWebhookEvent('{ "foo": "malformed"')

    // assert
    expect(successResult).toEqual({
      type: 'task_run.status',
      timestamp: expect.any(String),
      data: {
        run_id: '123',
        metadata: { task_id: 'get-brand-logo', attempt: 1, foo: 'bar' },
        status: 'completed',
        is_active: true,
        processor: ParallelProcessor.Base,
        created_at: expect.any(String),
        modified_at: expect.any(String),
      },
    })
    expect(managedFailureResult).toThrow(ParallelError)
  })

  it('should throw a ParallelError if the event metadata is invalid', async () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })
    const mockParallel = mock<IParallel>()

    // act
    const managedFailureResult = () =>
      webhookHandler.handleTaskWebhook(
        {
          type: 'task_run.status',
          timestamp: new Date().toISOString(),
          data: {
            run_id: '123',
            metadata: {},
            status: 'completed',
            is_active: true,
            processor: ParallelProcessor.Base,
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
          },
        },
        mockParallel
      )

    // assert
    await expect(managedFailureResult).rejects.toThrow(
      'Invalid task run status webhook event'
    )
  })

  it('should verify the webhook secret if a webhook secret is provided', async () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    const secret = '5b1e2d8b-8ea4-470d-94ec-5335283401a8'
    const parallel = new Parallel({ apiKey: secret, webhookSecret: secret })

    // act
    const successResult = await webhookHandler.verifyWebhookSecret(
      {
        payload:
          '{"type":"task_run.status","timestamp":"2025-08-01T23:23:40.445706+00:00","data":{"created_at":"2025-08-01T23:22:56.783274Z","taskgroup_id":null,"metadata":{"task_id":"brand-logo","webhook_url":"https://4a6b4586206987.lhr.life/webhooks/parallel","attempt":1.0},"warnings":null,"run_id":"trun_9f802d7fc9a743e994432c2e2c8a553b","is_active":false,"processor":"base","error":null,"status":"completed","modified_at":"2025-08-01T23:23:40.269668Z"}}',
        webhookSignature: 'v1,FI9JWvsXRSmxHHqVS4tvdufOergwijRngyEHjv6jxbY',
        webhookId: 'whevent_a316c67f0e6843f1b61aff86237c843f',
        webhookTimestamp: '1754090621',
      },
      parallel
    )

    // assert
    expect(successResult).toBe(true)
  })

  it('should return false if the webhook secret is invalid', async () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    const secret = '5b1e2d8b-8ea4-470d-94ec-5335283401a8'
    const parallel = new Parallel({ apiKey: secret, webhookSecret: secret })

    // act
    const failureResult = await webhookHandler.verifyWebhookSecret(
      {
        payload:
          '{"type":"task_run.status","timestamp":"20201T23:23:40.445706+00:00","data":{"created_at":"2025-08-01T23:22:56.783274Z","taskgroup_id":null,"metadata":{"task_id":"brand-logo","webhook_url":"https://4a6b4586206987.lhr.life/webhooks/parallel","attempt":1.0},"warnings":null,"run_id":"trun_9f802d7fc9a743e994432c2e2c8a553b","is_active":false,"processor":"base","error":null,"status":"completed","modified_at":"2025-08-01T23:23:40.269668Z"}}',
        webhookSignature: 'v1,FI9JWvsXRSmxHHqVS4tvdufOergwijRngyEHjv6jxbY',
        webhookId: 'whevent_a316c67f0e6843f1b61aff86237c843f',
        webhookTimestamp: '1754090621',
      },
      parallel
    )

    // assert
    expect(failureResult).toBe(false)
  })

  it('should return true if no webhook secret in client', async () => {
    // arrange
    const parallel = new Parallel({ apiKey: '123' })
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    // act
    const successResult = await webhookHandler.verifyWebhookSecret(
      {
        payload: '123',
        webhookSignature: '123',
        webhookId: '123',
        webhookTimestamp: '123',
      },
      parallel
    )

    // assert
    expect(successResult).toBe(true)
  })

  it('should return false if an error occurs', async () => {
    // arrange
    const webhookHandler = new ParallelWebhookHandler({
      taskWebhooks: [],
      logger: mockLogger,
    })

    const secret = '5b1e2d8b-8ea4-470d-94ec-5335283401a8'
    const parallel = new Parallel({ apiKey: secret, webhookSecret: secret })

    // act
    const failureResult = await webhookHandler.verifyWebhookSecret(
      {
        webhookSignature: null as unknown as string,
        webhookId: 'wh_123',
        webhookTimestamp: '1234567890',
        payload: '{"test": "data"}',
      },
      parallel
    )

    // assert
    expect(failureResult).toBe(false)
  })
})
