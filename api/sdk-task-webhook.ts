import z, { ZodSchema } from 'zod'

import { zodToJsonSchema } from 'zod-to-json-schema'
import { ParallelError, WrapErrorsIn } from './sdk-errors'
import { Logger } from './sdk-logging'
import { JsonSchema, TaskRun } from './types.gen'
import {
  CreateTaskRunResult,
  IParallel,
  ParallelProcessor,
} from './sdk-parallel'
import { ParallelTaskRunStatusWebhookEvent } from './sdk-webhook'
import {
  taskRunMetadataZodSchema,
  taskRunStatusWebhookEventZodSchema,
} from './sdk-schemas'
import { ParallelTaskDefinition, TaskRunForTask } from './sdk-task-definition'

export interface ParallelTaskWebhookOptions<
  TIdentifier extends string,
  TInput extends { [key: string]: unknown },
  TOutput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> {
  /**
   * Represents a task to be executed in parallel within a broader system or workflow.
   *
   * @type {ParallelTaskDefinition<TIdentifier, TInput, TOutput, TMetadata>}
   * @template TIdentifier - The type representing the unique identifier for the task.
   * @template TInput - The type representing the input data structure required for the task.
   * @template TOutput - The type representing the output data structure produced by the task.
   * @template TMetadata - The type representing any additional metadata associated with the task.
   */
  task: ParallelTaskDefinition<TIdentifier, TInput, TOutput, TMetadata>
  /**
   * The output schema of the task
   */
  onSuccess?: (
    output: TOutput,
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<void> | void
  /**
   * The number of times to retry the task run if it fails
   * @type {number} - The number of times to retry the task run if it fails
   * @type {Record<ParallelProcessor, number>} - If provided, the number of times to retry the task run if it fails for each processor, once all retires for one processor are exhausted, the next most capable processor will be used
   * @default - 0 - no retries will be attempted
   */
  retries?: number | Partial<{ [key in ParallelProcessor]: number }>
  /**
   * A handler to call when the task run status is `success` in a webhook but retries should be attempted conditionally based on the output
   * @param output - The output of the task run
   * @returns A boolean indicating whether retries should be attempted
   * @default - no retries will be attempted
   */
  outputIsFailure?: (
    output: TOutput,
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<boolean> | boolean
  /**
   * A handler to call when the task run status is `failed` in a webhook
   * @param taskRun - The task run
   * @default - no-operation will be performed when webhook events are received
   */
  onFailure?: (
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<void> | void
  /**
   * The logger to use for the task definition
   * @default - no logging will be performed
   */
  logger?: Logger
}

export class ParallelTaskWebhook<
  TIdentifier extends string,
  TInput extends { [key: string]: unknown },
  TOutput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> {
  /**
   * The task this webhook configuration is for
   */
  public task: ParallelTaskDefinition<TIdentifier, TInput, TOutput, TMetadata>
  private readonly onSuccess?: (
    output: TOutput,
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<void> | void
  private readonly retries?:
    | number
    | Partial<{ [key in ParallelProcessor]: number }>
  private readonly outputIsFailure?: (
    output: TOutput,
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<boolean> | boolean
  private readonly onFailure?: (
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ) => Promise<void> | void
  /**
   * The logger to use for the task definition
   * @default - no logging will be performed
   */
  private logger?: Logger

  constructor(
    definition: ParallelTaskWebhookOptions<
      TIdentifier,
      TInput,
      TOutput,
      TMetadata
    >
  ) {
    this.task = definition.task
    this.onSuccess = definition.onSuccess
    this.retries = definition.retries
    this.outputIsFailure = definition.outputIsFailure
    this.onFailure = definition.onFailure
    this.logger = definition.logger
  }

  private getNextProcessor(
    attempt: number,
    currentProcessor: ParallelProcessor,
    retries: number | Partial<{ [key in ParallelProcessor]: number }>
  ): ParallelProcessor | null {
    if (typeof retries === 'number') return currentProcessor
    const allowedRetriesOnCurrentProcessor = retries[currentProcessor]!
    if (attempt < allowedRetriesOnCurrentProcessor) {
      return currentProcessor
    }
    const processorsOrderedByCapability = [
      ParallelProcessor.Lite,
      ParallelProcessor.Base,
      ParallelProcessor.Core,
      ParallelProcessor.Pro,
      ParallelProcessor.Ultra,
    ]
    const currentProcessorIndex =
      processorsOrderedByCapability.indexOf(currentProcessor)
    const nextProcessor = processorsOrderedByCapability.find(
      (processor, index) =>
        retries[processor] !== undefined &&
        retries[processor] > 0 &&
        index > currentProcessorIndex
    )
    return nextProcessor!
  }

  private async shouldRetryWebhookTaskRun(
    taskRun: TaskRunForTask<TIdentifier, TMetadata>
  ): Promise<boolean> {
    if (!this.retries || !taskRun.metadata.attempt) return false
    if (typeof this.retries === 'number') {
      return taskRun.metadata.attempt < this.retries
    }
    const currentProcessor = z
      .nativeEnum(ParallelProcessor)
      .parse(taskRun.processor)
    const nextProcessor = this.getNextProcessor(
      taskRun.metadata.attempt,
      currentProcessor,
      this.retries
    )
    if (!nextProcessor) return false
    const newProcessorOnThisAttempt = nextProcessor !== currentProcessor
    if (newProcessorOnThisAttempt) return true
    const allowedRetriesOnCurrentProcessor = this.retries[currentProcessor] ?? 0
    return taskRun.metadata.attempt <= allowedRetriesOnCurrentProcessor
  }

  private async retryWebhookTaskRun(
    taskRun: TaskRunForTask<TIdentifier, TMetadata>,
    parallel: IParallel
  ): Promise<void> {
    this.logger?.info('Parallel: Retrying task run', {
      task_id: this.task.identifier,
      run_id: taskRun.run_id,
    })
    const input = await this.task.getRunInput(taskRun.run_id, parallel)
    const currentProcessor = z
      .nativeEnum(ParallelProcessor)
      .parse(taskRun.processor)
    const nextProcessor = this.getNextProcessor(
      taskRun.metadata.attempt!,
      currentProcessor,
      this.retries!
    )
    if (!nextProcessor) return
    const newProcessorOnThisAttempt = nextProcessor !== currentProcessor
    await this.task.startRun(
      {
        input,
        processor: nextProcessor,
        webhook: new URL(taskRun.metadata.webhook_url!),
        metadata: {
          ...taskRun.metadata,
          attempt: newProcessorOnThisAttempt
            ? 1
            : taskRun.metadata.attempt! + 1,
        },
      },
      parallel
    )
  }

  /**
   * Handle a webhook event for a task run, unwraps the event, validates the metadata, and calls the task run status success webhook handler
   * @param event - The webhook event
   * @param parallel - The parallel client to use
   */
  @WrapErrorsIn(ParallelError)
  public async webhook(
    event: ParallelTaskRunStatusWebhookEvent,
    parallel: IParallel
  ) {
    const parsed = taskRunStatusWebhookEventZodSchema.safeParse(event)
    if (!parsed.success) {
      throw new ParallelError(`Invalid task run status webhook event`, {
        cause: parsed.error,
      })
    }
    if (parsed.data.data.metadata.task_id !== this.task.identifier) return
    this.logger?.info('Parallel: Compatible webhook event received by task', {
      task_id: this.task.identifier,
      event: parsed.data,
    })
    const runId = parsed.data.data.run_id
    if (event.type === 'task_run.status') {
      const taskRun = await this.task.getRun(runId, parallel)
      if (event.data.status === 'completed') {
        const output = await this.task.getRunOutput(runId, parallel)
        if (
          this.outputIsFailure &&
          (await this.outputIsFailure(output, taskRun))
        ) {
          if (await this.shouldRetryWebhookTaskRun(taskRun)) {
            await this.retryWebhookTaskRun(taskRun, parallel)
          } else {
            await this.onFailure?.(taskRun)
          }
        } else if (this.onSuccess) {
          this.logger?.info('Parallel: Webhook event successful for task', {
            task_id: this.task.identifier,
            run_id: taskRun.run_id,
            output,
          })
          await this.onSuccess(output, taskRun)
        }
      } else if (event.data.status === 'failed') {
        if (await this.shouldRetryWebhookTaskRun(taskRun)) {
          await this.retryWebhookTaskRun(taskRun, parallel)
        } else {
          await this.onFailure?.(taskRun)
        }
      }
    }
  }
}
