import { Options } from './client'
import { client } from './client.gen'
import { ParallelError, WrapErrorsIn } from './sdk-errors'
import { Logger } from './sdk-logging'
import {
  tasksRunsGetV1TasksRunsRunIdGet,
  tasksRunsInputGetV1TasksRunsRunIdInputGet,
  tasksRunsPostV1TasksRunsPost,
  tasksRunsResultGetV1TasksRunsRunIdResultGet,
} from './sdk.gen'
import {
  TasksRunsGetV1TasksRunsRunIdGetData,
  TasksRunsInputGetV1TasksRunsRunIdInputGetData,
  TasksRunsPostV1TasksRunsPostData,
  TasksRunsResultGetV1TasksRunsRunIdResultGetData,
} from './types.gen'

/**
 * Processors are the engines that execute Task Runs. The choice of Processor determines the performance profile and reasoning behavior used. Pricing is determined by which Processor you select, not by the Task Run itself. Any Task Run can be executed on any Processor.
 * @see https://docs.parallel.ai/core-concepts/processors
 */
export enum ParallelProcessor {
  /**
   * 	Handles basic, one-hop information retrieval Tasks. Lowest compute cost and also typically lower latency
   */
  Lite = 'lite',
  /**
   * Great for basic to moderate‑complexity enrichments (e.g., company firmographics). Executes a simpler retrieval and reasoning to fill 1‑6 columns.
   */
  Base = 'base',
  /**
   * The workhorse processor, best on price-performance. Performs multi‑hop reasoning, cross‑validating facts across multiple sources. Ideal for moderate complexity tasks where trust and scale both matter.
   */
  Core = 'core',
  /**
   * 	Designed for longer‑running, high‑complexity tasks. Reliably populates up to 20 output fields, with cross-validation, confidence and excerpts.
   */
  Pro = 'pro',
  /**
   * The most advanced processor. Runs open‑ended research with extensive retrieval and multi‑stage reasoning, human‑quality analyses on some complex tasks.
   */
  Ultra = 'ultra',
}

export type CreateTaskRunOptions = Options<TasksRunsPostV1TasksRunsPostData>
export type CreateTaskRunResult = ReturnType<
  typeof tasksRunsPostV1TasksRunsPost
>
export type CreateTaskRunWithWebhookOptions = Options<
  Omit<TasksRunsPostV1TasksRunsPostData, 'body'> & {
    body: Options<TasksRunsPostV1TasksRunsPostData>['body'] & {
      webhook: { url: string }
    }
  }
>
export type GetTaskRunOptions = Options<TasksRunsGetV1TasksRunsRunIdGetData>
export type GetTaskRunResult = ReturnType<
  typeof tasksRunsGetV1TasksRunsRunIdGet
>

export type GetTaskRunInputOptions =
  Options<TasksRunsInputGetV1TasksRunsRunIdInputGetData>
export type GetTaskRunInputResult = ReturnType<
  typeof tasksRunsInputGetV1TasksRunsRunIdInputGet
>
export type GetTaskRunResultOptions =
  Options<TasksRunsResultGetV1TasksRunsRunIdResultGetData>
export type GetTaskRunResultResult = ReturnType<
  typeof tasksRunsResultGetV1TasksRunsRunIdResultGet
>

export interface IParallel {
  webhookSecret?: string
  createTaskRun(options: CreateTaskRunOptions): Promise<CreateTaskRunResult>
  createTaskRunWithWebhook(
    options: CreateTaskRunWithWebhookOptions
  ): Promise<CreateTaskRunResult>
  getTaskRun(options: GetTaskRunOptions): Promise<GetTaskRunResult>
  getTaskRunInput(
    options: GetTaskRunInputOptions
  ): Promise<GetTaskRunInputResult>
  getTaskRunResult(
    options: GetTaskRunResultOptions
  ): Promise<GetTaskRunResultResult>
}

export interface ParallelOptions {
  /**
   * The API key to use for the Parallel client.
   */
  apiKey: string
  /**
   * The webhook secret to use when creating a task run with a webhook
   * @default undefined
   */
  webhookSecret?: string
  /**
   * The base URL to use for the Parallel client.
   * @default https://api.parallel.ai
   */
  baseUrl?: string
  /**
   * The logger to use for the Parallel client.
   * @default - no logging will be performed
   */
  logger?: Logger
}

/**
 * Standard Parallel client implementation
 */
export class Parallel implements IParallel {
  private readonly apiKey: string
  public readonly webhookSecret?: string
  private readonly logger?: Logger
  constructor(options: ParallelOptions) {
    this.apiKey = options.apiKey
    this.webhookSecret = options.webhookSecret
    client.setConfig({
      auth: this.apiKey,
      baseUrl: options.baseUrl ?? 'https://api.parallel.ai',
    })
    this.logger = options.logger
  }

  /**
   * Create a new task run that will not trigger a webhook
   * @param options - The options for the task run
   * @returns The created task run
   */
  @WrapErrorsIn(ParallelError)
  public async createTaskRun(
    options: CreateTaskRunOptions
  ): Promise<CreateTaskRunResult> {
    this.logger?.info('Parallel: Creating task run', { options })
    const result = await tasksRunsPostV1TasksRunsPost(options)
    this.logger?.info('Parallel: Task run created', { result })
    return result
  }

  /**
   * Create a new task run that will trigger a webhook
   * @param options - The options for the task run
   * @returns The created task run
   */
  @WrapErrorsIn(ParallelError)
  public async createTaskRunWithWebhook(
    options: CreateTaskRunWithWebhookOptions
  ): Promise<CreateTaskRunResult> {
    this.logger?.info('Parallel: Creating task run with webhook', { options })
    const result = await client.post({
      url: '/v1beta/tasks/runs',
      headers: {
        'x-api-key': this.apiKey,
      },
      body: {
        ...options.body,
        webhook: {
          url: options.body.webhook.url,
          event_types: ['task_run.status'],
          secret: this.webhookSecret,
        },
      },
    })
    this.logger?.info('Parallel: Task run created with webhook', { result })
    return result as unknown as CreateTaskRunResult
  }

  /**
   * Get a task run by its ID
   * @param options - The options for the task run
   * @returns The task run
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRun(
    options: GetTaskRunOptions
  ): Promise<GetTaskRunResult> {
    this.logger?.info('Parallel: Getting task run', { options })
    const result = await tasksRunsGetV1TasksRunsRunIdGet(options)
    this.logger?.info('Parallel: Task run retrieved', { result })
    return result
  }

  /**
   * Get a task run input by its ID
   * @param options - The options for the task run input
   * @returns The task run input
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRunInput(
    options: GetTaskRunInputOptions
  ): Promise<GetTaskRunInputResult> {
    this.logger?.info('Parallel: Getting task run input', { options })
    const result = await tasksRunsInputGetV1TasksRunsRunIdInputGet(options)
    this.logger?.info('Parallel: Task run input retrieved', { result })
    return result
  }

  /**
   * Get a task run result by its ID
   * @param options - The options for the task run result
   * @returns The task run result
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRunResult(
    options: GetTaskRunResultOptions
  ): Promise<GetTaskRunResultResult> {
    this.logger?.info('Parallel: Getting task run result', { options })
    const result = await tasksRunsResultGetV1TasksRunsRunIdResultGet(options)
    this.logger?.info('Parallel: Task run result retrieved', { result })
    return result
  }
}
