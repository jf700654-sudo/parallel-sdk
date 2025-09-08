import { ParallelError, WrapErrorsIn } from './sdk-errors'
import crypto from 'crypto'
import { normalizeBase64Padding } from './base-encoding'
import { Logger } from './sdk-logging'
import { TaskRun } from './types.gen'
import { IParallel } from './sdk-parallel'
import { ParallelTaskDefinition } from './sdk-task-definition'
import {
  taskRunMetadataZodSchema,
  taskRunStatusWebhookEventZodSchema,
} from './sdk-schemas'
import { ParallelTaskWebhook } from './sdk-task-webhook'

export interface ParallelTaskRunStatusWebhookEvent {
  timestamp: string
  type: 'task_run.status'
  data: TaskRun
}

export type ParallelWebhookEvent = ParallelTaskRunStatusWebhookEvent

/**
 * The parameters for verifying the webhook secret
 */
export interface VerifyWebhookSecretParameters {
  /**
   * The ID of the webhook, from the `webhook-id` header
   */
  webhookId: string
  /**
   * The timestamp of the webhook, from the `webhook-timestamp` header
   */
  webhookTimestamp: string
  /**
   * The signature of the webhook, from the `webhook-signature` header
   */
  webhookSignature: string
  /**
   * The received JSON payload of the webhook
   */
  payload: string
}

export interface ParallelWebhookHandlerOptions {
  /**
   * The task definitions to handle webhook events for
   */
  taskWebhooks: ParallelTaskWebhook<any, any, any, any>[]
  /**
   * The logger to use for the webhook handler
   * @default - no logging will be performed
   */
  logger?: Logger
}

/**
 * A handler for webhook events for a set of task definitions.
 * @param taskDefinitions - The task definitions to handle webhook events for
 */
export class ParallelWebhookHandler {
  private readonly taskWebhooks: Map<
    string,
    ParallelTaskWebhook<
      string,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, string | number | boolean>
    >
  >
  private readonly logger?: Logger

  constructor(options: ParallelWebhookHandlerOptions) {
    this.logger = options.logger
    this.taskWebhooks = new Map(
      options.taskWebhooks.map((taskDefinition) => [
        taskDefinition.task.identifier,
        taskDefinition,
      ])
    )
    if (this.taskWebhooks.size !== options.taskWebhooks.length) {
      throw new ParallelError(
        'Duplicate task definitions provided to webhook handler'
      )
    }
  }

  /**
   * Verify the secret of a webhook event
   * @param parameters - The required parameters for verifying the webhook secret
   * @param parallel - The parallel client to use
   * @returns `true` if the webhook secret is valid
   * @throws - A `ParallelError` if the webhook secret is invalid
   */
  @WrapErrorsIn(ParallelError)
  public async verifyWebhookSecret(
    parameters: VerifyWebhookSecretParameters,
    parallel: IParallel
  ): Promise<boolean> {
    const secret = parallel.webhookSecret
    if (!secret) return true
    try {
      const [_version, receivedSignature] =
        parameters.webhookSignature.split(',')
      const toSign = `${parameters.webhookId}.${parameters.webhookTimestamp}.${parameters.payload}`
      const hmac = crypto.createHmac('sha256', secret)
      hmac.update(toSign)
      const expectedSignature = hmac.digest('base64')
      const valid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(normalizeBase64Padding(receivedSignature))
      )
      if (!valid) {
        this.logger?.warn('Parallel: Invalid webhook secret received', {
          cause: parameters,
        })
        return false
      }
      return true
    } catch (error) {
      this.logger?.warn('Parallel: Invalid webhook secret received', {
        cause: error,
      })
      return false
    }
  }

  /**
   * Parse a webhook event into a strongly-typed webhook event
   * @param input - The webhook event to parse
   * @returns The parsed webhook event
   */
  @WrapErrorsIn(ParallelError)
  public parseWebhookEvent(input: unknown): ParallelWebhookEvent {
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input)
      } catch {
        throw new ParallelError(`Invalid task run status webhook event`, {
          cause: input,
        })
      }
    }
    const parsed = taskRunStatusWebhookEventZodSchema.safeParse(input)
    if (!parsed.success) {
      throw new ParallelError(`Invalid task run status webhook event`, {
        cause: parsed.error,
      })
    }
    this.logger?.info('Parallel: Successfully parsed webhook event', {
      event: parsed.data,
    })
    return parsed.data
  }

  /**
   * Handle a webhook event. Finds the task definition for the task run and calls the webhook handler.
   * @param event - The webhook event
   * @param parallel - The parallel client to use
   */
  @WrapErrorsIn(ParallelError)
  public async handleTaskWebhook(
    event: ParallelWebhookEvent,
    parallel: IParallel
  ): Promise<void> {
    const parsedMetadata = taskRunMetadataZodSchema.safeParse(
      event.data.metadata
    )
    if (!parsedMetadata.success) {
      throw new ParallelError(`Invalid task run status webhook event`, {
        cause: parsedMetadata.error,
      })
    }
    const taskWebhook = this.taskWebhooks.get(parsedMetadata.data.task_id)
    if (!taskWebhook) {
      this.logger?.warn('Parallel: Missing task definition for task', {
        task_id: parsedMetadata.data.task_id,
        event,
      })
      return
    }
    await taskWebhook.webhook(event, parallel)
    this.logger?.info('Parallel: Successfully handled webhook event for task', {
      task_id: parsedMetadata.data.task_id,
      event,
    })
  }
}
