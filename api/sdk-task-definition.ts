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

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

/**
 * Interface for a task JSON input/output schema compatible with task runs
 * @param T - The held type of the task JSON input/output schema
 */
export interface ParallelTaskJsonIO<T extends { [key: string]: unknown }> {
  /**
   * The description of the task JSON input/output schema
   */
  description: string
  jsonSchema: JsonSchema
  parse: (input: unknown) => T
}

/**
 * Options for creating a Zod-based task JSON input/output schema
 * @param T - The held type of the task JSON input/output schema
 */
export interface ZodParallelTaskJsonIOOptions<
  T extends { [key: string]: unknown },
> {
  /**
   * The description of the task JSON input/output schema
   */
  description: string
  /**
   * The Zod schema to use for the task JSON input/output schema
   */
  schema: ZodSchema<T>
}

/**
 * Zod-based implementation of a task JSON input/output schema
 * @param description - The description of the task JSON input/output schema
 * @param zodSchema - The Zod schema to use for the task JSON input/output schema
 */
export class ZodParallelTaskJsonIO<T extends { [key: string]: unknown }>
  implements ParallelTaskJsonIO<T>
{
  description: string
  jsonSchema: JsonSchema
  parse: (input: unknown) => T

  constructor(options: ZodParallelTaskJsonIOOptions<T>) {
    this.description = options.description
    this.jsonSchema = {
      type: 'json',
      json_schema: zodToJsonSchema(options.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }),
    }
    this.parse = (input: unknown) => {
      const parsed = options.schema.safeParse(input)
      if (!parsed.success) {
        throw new ParallelError(`Invalid ${this.description} input`, {
          cause: parsed.error,
        })
      }
      return parsed.data
    }
  }
}

/**
 * Interface for a task metadata schema
 * @param T - The held type of the task metadata schema
 */
export interface ParallelTaskMetadata<
  T extends { [key: string]: string | number | boolean },
> {
  parse: (input: unknown) => T
}

/**
 * Zod-based implementation of a task run metadata schema
 * @param zodSchema - The Zod schema to use for the task metadata schema
 */
export class ZodParallelTaskMetadata<
  T extends { [key: string]: string | number | boolean },
> implements ParallelTaskMetadata<T>
{
  parse: (input: unknown) => T

  constructor(options: { schema: ZodSchema<T> }) {
    this.parse = (input: unknown) => {
      const parsed = options.schema.safeParse(input)
      if (!parsed.success) {
        throw new ParallelError(`Invalid task metadata`, {
          cause: parsed.error,
        })
      }
      return parsed.data
    }
  }
}

export type TaskRunDefaultMetadata<TIdentifier extends string> = {
  task_id: TIdentifier
  attempt?: number
  webhook_url?: string
}

export type TaskRunForTask<
  TIdentifier extends string,
  TMetadata extends { [key: string]: string | number | boolean },
> = Omit<TaskRun, 'metadata'> & {
  metadata: TMetadata &
    TaskRunDefaultMetadata<TIdentifier> &
    TaskRun['metadata']
}

/**
 * Options for starting a typed task run
 * @param TInput - The type of the task input
 * @param TMetadata - The type of the task metadata
 */
export interface StartRunOptions<
  TInput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> {
  /**
   * The input for the task run
   */
  input: TInput
  /**
   * The processor to use for the task run
   * @default - the default processor for the task definition
   */
  processor?: ParallelProcessor
  /**
   * The metadata for the task run
   */
  metadata: TMetadata & { attempt?: number }
  /**
   * The webhook to use for the task run. If provided, a webhook event will be sent to the provided URL.
   * @default - no webhook will be sent
   */
  webhook?: URL
}

interface PollingOptions {
  /**
   * The timeout for the polling operation
   * @default - a default timeout will be used based on the processor
   */
  timeoutMs?: number
  /**
   * The interval between polling attempts
   * @default - 2 seconds
   */
  intervalMs?: number
  /**
   * The backoff exponent for the polling operation
   * @default - 1.5
   */
  backoffExponent?: number
}

/**
 * The necessary options for creating a strongly-typed task definition
 * @param TIdentifier - The type of the task identifier
 * @param TInput - The type of the task input
 * @param TOutput - The type of the task output
 * @param TMetadata - The type of the task metadata
 */
export interface ParallelTaskDefinitionOptions<
  TIdentifier extends string,
  TInput extends { [key: string]: unknown },
  TOutput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> {
  /**
   * The identifier of the task appended to `metadata.task_id` for tasks run via `ParallelTaskDefinition` instances
   */
  identifier: TIdentifier
  /**
   * The input schema of the task
   */
  input: ParallelTaskJsonIO<TInput>
  /**
   * The output schema of the task
   */
  output: ParallelTaskJsonIO<TOutput>
  /**
   * The metadata schema of the task
   */
  metadata: ParallelTaskMetadata<TMetadata>
  /**
   * The processor to use for the task run
   */
  defaultProcessor: ParallelProcessor
  /**
   * The logger to use for the task definition
   * @default - no logging will be performed
   */
  logger?: Logger
}

export class ParallelTaskDefinition<
  TIdentifier extends string,
  TInput extends { [key: string]: unknown },
  TOutput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> {
  /**
   * The identifier of the task
   */
  identifier: TIdentifier
  /**
   * The input schema of the task
   */
  input: ParallelTaskJsonIO<TInput>
  /**
   * The output schema of the task
   */
  output: ParallelTaskJsonIO<TOutput>
  /**
   * The metadata schema of the task
   */
  metadata: ParallelTaskMetadata<TMetadata>
  /**
   * The default processor to use for the task run
   */
  defaultProcessor: ParallelProcessor
  /**
   * The logger to use for the task definition
   * @default - no logging will be performed
   */
  private logger?: Logger

  constructor(
    definition: ParallelTaskDefinitionOptions<
      TIdentifier,
      TInput,
      TOutput,
      TMetadata
    >
  ) {
    this.identifier = definition.identifier
    this.input = definition.input
    this.output = definition.output
    this.metadata = {
      parse: (input) => {
        const metadata = taskRunMetadataZodSchema.parse(input)
        return definition.metadata.parse(metadata)
      },
    }
    this.defaultProcessor = definition.defaultProcessor
    this.logger = definition.logger
  }

  private parseMetadata(input: {
    metadata?: { [key: string]: string | number | boolean } | null | undefined
  }): TMetadata & TaskRunDefaultMetadata<TIdentifier> & TaskRun['metadata'] {
    if (!input.metadata) {
      throw new ParallelError(
        `Invalid run of ${this.identifier}: missing metadata`,
        {
          cause: input,
        }
      )
    }
    const parsed = taskRunMetadataZodSchema.safeParse(input.metadata)
    if (!parsed.success) {
      throw new ParallelError(
        `Invalid run of ${this.identifier}: default metadata invalid`,
        {
          cause: parsed.error,
        }
      )
    }
    if (parsed.data.task_id !== this.identifier) {
      throw new ParallelError(
        `Invalid run of ${this.identifier}: invalid task_id`,
        {
          cause: parsed.data.task_id,
        }
      )
    }
    try {
      return {
        ...this.metadata.parse(input.metadata),
        task_id: parsed.data.task_id as TIdentifier,
        attempt: parsed.data.attempt,
        webhook_url: parsed.data.webhook_url as string,
      }
    } catch (error) {
      throw new ParallelError(
        `Invalid run of ${this.identifier}: invalid metadata`,
        {
          cause: error,
        }
      )
    }
  }

  /**
   * Start a task run with the provided input and metadata
   * @param parameters - The input and metadata for the task run
   * @param parallel - The parallel client to use
   * @returns The created task run
   */
  @WrapErrorsIn(ParallelError)
  public async startRun(
    parameters: StartRunOptions<TInput, TMetadata>,
    parallel: IParallel
  ): Promise<TaskRunForTask<TIdentifier, TMetadata>> {
    let taskRun: UnwrapPromise<CreateTaskRunResult>
    if (parameters.webhook) {
      taskRun = await parallel.createTaskRunWithWebhook({
        body: {
          processor: parameters.processor ?? this.defaultProcessor,
          metadata: {
            ...parameters.metadata,
            task_id: this.identifier,
            attempt: parameters.metadata.attempt ?? 1,
            webhook_url: parameters.webhook.toString(),
          },
          input: parameters.input,
          task_spec: {
            output_schema: this.output.jsonSchema,
            input_schema: this.input.jsonSchema,
          },
          webhook: { url: parameters.webhook.toString() },
        },
      })
    } else {
      taskRun = await parallel.createTaskRun({
        body: {
          processor: parameters.processor ?? this.defaultProcessor,
          metadata: {
            ...parameters.metadata,
            task_id: this.identifier,
            attempt: 1,
          },
          input: parameters.input,
          task_spec: {
            output_schema: this.output.jsonSchema,
            input_schema: this.input.jsonSchema,
          },
        },
      })
    }
    if (taskRun.data) {
      return {
        ...taskRun.data,
        metadata: this.parseMetadata(taskRun.data),
      }
    } else {
      throw new ParallelError(
        `Failed to create task run for ${this.identifier}`,
        {
          cause: taskRun.error,
        }
      )
    }
  }

  /**
   * Get a task run by its ID
   * @param runId - The ID of the task run
   * @param parallel - The parallel client to use
   * @returns The task run with the provided ID
   */
  @WrapErrorsIn(ParallelError)
  public async getRun(
    runId: string,
    parallel: IParallel
  ): Promise<TaskRunForTask<TIdentifier, TMetadata>> {
    const taskRun = await parallel.getTaskRun({ path: { run_id: runId } })
    if (taskRun.data) {
      return { ...taskRun.data, metadata: this.parseMetadata(taskRun.data) }
    }
    throw new ParallelError(`Failed to get task run for ${this.identifier}`, {
      cause: taskRun.error,
    })
  }

  /**
   * Get the input of a task run by its ID
   * @param runId - The ID of the task run
   * @param parallel - The parallel client to use
   * @returns The input of the task run with the provided ID
   */
  @WrapErrorsIn(ParallelError)
  public async getRunInput(
    runId: string,
    parallel: IParallel
  ): Promise<TInput> {
    const taskRunInput = await parallel.getTaskRunInput({
      path: { run_id: runId },
    })
    if (taskRunInput.data) {
      this.parseMetadata(taskRunInput.data)
      return this.input.parse(taskRunInput.data.input)
    }
    throw new ParallelError(
      `Failed to get task run input for ${this.identifier}`,
      {
        cause: taskRunInput.error,
      }
    )
  }

  /**
   * Get the output of a task run by its ID
   * @param runId - The ID of the task run
   * @param parallel - The parallel client to use
   * @returns The output of the task run with the provided ID
   */
  @WrapErrorsIn(ParallelError)
  public async getRunOutput(
    runId: string,
    parallel: IParallel
  ): Promise<TOutput> {
    const taskRunResult = await parallel.getTaskRunResult({
      path: { run_id: runId },
    })
    if (taskRunResult.data) {
      this.parseMetadata(taskRunResult.data.run)
      if (taskRunResult.data.output.type !== 'json') {
        throw new ParallelError(`Invalid output type for ${this.identifier}`, {
          cause: taskRunResult.data.output,
        })
      }
      return this.output.parse(taskRunResult.data.output.content)
    }
    throw new ParallelError(
      `Failed to get task run result for ${this.identifier}`,
      {
        cause: taskRunResult.error,
      }
    )
  }

  /**
   * Poll for the output of a task run by its ID until it is completed, fails, or times out
   * @param runId - The ID of the task run
   * @param parallel - The parallel client to use
   * @param pollingOptions - The options for polling
   * @throws - A `ParallelError` if the task run fails or times out
   * @returns The output of the task run with the provided ID
   */
  @WrapErrorsIn(ParallelError)
  public async pollForRunOutput(
    runId: string,
    parallel: IParallel,
    pollingOptions?: PollingOptions
  ): Promise<TOutput> {
    const taskRun = await this.getRun(runId, parallel)

    const MINUTE_IN_MS = 60 * 1_000
    const defaultTimeoutMs: Record<ParallelProcessor, number> = {
      [ParallelProcessor.Lite]: MINUTE_IN_MS,
      [ParallelProcessor.Base]: MINUTE_IN_MS * 2,
      [ParallelProcessor.Core]: MINUTE_IN_MS * 4,
      [ParallelProcessor.Pro]: MINUTE_IN_MS * 8,
      [ParallelProcessor.Ultra]: MINUTE_IN_MS * 16,
    }
    const { timeoutMs, intervalMs, backoffExponent } = {
      timeoutMs: defaultTimeoutMs[taskRun.processor as ParallelProcessor],
      intervalMs: 2_000,
      backoffExponent: 1.5,
      ...pollingOptions,
    }
    this.logger?.info('Parallel: Polling for task run output', {
      task_id: this.identifier,
      runId,
      processor: taskRun.processor,
      timeoutMs,
      intervalMs,
      backoffExponent,
    })
    const startTime = Date.now()
    let backoff = 1
    while (Date.now() - startTime < timeoutMs) {
      const taskRun = await this.getRun(runId, parallel)
      this.parseMetadata(taskRun)
      if (taskRun.status === 'completed') {
        return await this.getRunOutput(runId, parallel)
      } else if (taskRun.status === 'failed') {
        throw new ParallelError(`Task run failed for ${this.identifier}`, {
          cause: taskRun,
        })
      }
      backoff = backoff * backoffExponent
      await new Promise((resolve) => setTimeout(resolve, intervalMs * backoff))
    }
    throw new ParallelError(`Task run check failed with this timeout`, {
      cause: taskRun,
    })
  }
}
