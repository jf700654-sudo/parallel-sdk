import { delay, Subject, tap } from 'rxjs'
import { randomUUID } from 'crypto'
import { ParallelError, WrapErrorsIn } from './sdk-errors'
import { ParallelWebhookEvent, ParallelWebhookHandler } from './sdk-webhook'
import { TaskRun } from './types.gen'
import {
  CreateTaskRunOptions,
  CreateTaskRunResult,
  CreateTaskRunWithWebhookOptions,
  GetTaskRunInputOptions,
  GetTaskRunInputResult,
  GetTaskRunOptions,
  GetTaskRunResult,
  GetTaskRunResultOptions,
  GetTaskRunResultResult,
  IParallel,
} from './sdk-parallel'
import { ParallelTaskDefinition } from './sdk-task-definition'

/**
 * Options for creating a mock parallel client for a task definition
 * @param TInput - The type of the task input
 * @param TOutput - The type of the task output
 */
export interface MockParallelForTaskDefinitionOptions<TInput, TOutput> {
  /**
   * If a task run is successful, this function will be called to simulate the output of the task run from the server
   * @param input - The input of the task run
   * @returns The output of the task run
   */
  outputFactory: (input: TInput) => TOutput
  /**
   * The likelihood of a task run being successful between 0 and 1
   */
  successLikelihood: number
  /**
   * The time in milliseconds to wait before resolving a task run as successful or failed
   */
  timeToResolveMs: number
  /**
   * If provided, a webhook event will be sent to this handler after the task run resolves as successful or failed
   * @default - no webhook will be sent
   */
  webhookHandler?: ParallelWebhookHandler
}

/**
 * A mock parallel client that fully simulates the behavior of a parallel server for creating, polling, and retrieving task runs
 * Allows for more comprehensive testing of a ParallelTaskDefinition instance by allowing randomizing the resolution of task runs
 * Can be combined with a ParallelWebhookHandler to test webhook handling
 * @param TIdentifier - The type of the task identifier
 * @param TInput - The type of the task input
 * @param TOutput - The type of the task output
 * @param TMetadata - The type of the task metadata
 */
export class MockParallelForTaskDefinition<
  TIdentifier extends string,
  TInput extends { [key: string]: unknown },
  TOutput extends { [key: string]: unknown },
  TMetadata extends { [key: string]: string | number | boolean },
> implements IParallel
{
  private readonly taskRuns = new Map<string, TaskRun>()
  private readonly taskRunInputs = new Map<string, TInput>()
  private readonly taskRunResults = new Map<string, TOutput>()
  private readonly outputFactory: (input: TInput) => TOutput
  private readonly successLikelihood: number
  private readonly timeToResolveMs: number
  private readonly eventStream$ = new Subject<ParallelWebhookEvent>()
  private webhookHandler?: ParallelWebhookHandler
  constructor(
    private readonly taskDefinition: ParallelTaskDefinition<
      TIdentifier,
      TInput,
      TOutput,
      TMetadata
    >,
    options: MockParallelForTaskDefinitionOptions<TInput, TOutput>
  ) {
    this.outputFactory = options.outputFactory
    this.successLikelihood = options.successLikelihood
    this.timeToResolveMs = options.timeToResolveMs
    this.webhookHandler = options.webhookHandler
    this.eventStream$
      .pipe(
        delay(this.timeToResolveMs), // give time to set result
        tap(async (event) => {
          if (this.webhookHandler) {
            const taskRun = this.accessTaskRun(event.data.run_id)
            await this.webhookHandler.handleTaskWebhook(
              { ...event, data: taskRun! },
              this
            )
          }
        })
      )
      .subscribe()
  }

  /**
   * Set the webhook handler for this client
   * @param handler
   */
  @WrapErrorsIn(ParallelError)
  public updateWebhookHandler(handler: ParallelWebhookHandler) {
    this.webhookHandler = handler
  }

  /**
   * Create a task run with the provided input and metadata
   * @param options - The options for creating a task run
   * @returns The created task run
   */
  @WrapErrorsIn(ParallelError)
  public async createTaskRun(
    options: CreateTaskRunOptions
  ): Promise<CreateTaskRunResult> {
    const taskRun: TaskRun = {
      created_at: new Date().toISOString(),
      is_active: true,
      modified_at: new Date().toISOString(),
      processor: options.body.processor,
      run_id: randomUUID(),
      status: 'running',
      metadata: options.body.metadata,
    }
    this.taskRuns.set(taskRun.run_id, taskRun)
    this.taskRunInputs.set(
      taskRun.run_id,
      this.taskDefinition.input.parse(options.body.input)
    )
    return {
      data: taskRun,
      error: undefined,
      request: new Request('https://parallel.ai'),
      response: new Response(),
    }
  }

  /**
   * Create a task run with the provided input and metadata and send a webhook event to the event stream (will be automatically sent to the webhook handler if provided)
   * @param options - The options for creating a task run
   * @returns The created task run
   */
  @WrapErrorsIn(ParallelError)
  public async createTaskRunWithWebhook(
    options: CreateTaskRunWithWebhookOptions
  ): Promise<CreateTaskRunResult> {
    const taskRun = await this.createTaskRun(options)
    if (taskRun.data) {
      this.eventStream$.next({
        data: taskRun.data,
        timestamp: new Date().toISOString(),
        type: 'task_run.status',
      })
    }
    return taskRun
  }

  @WrapErrorsIn(ParallelError)
  private accessTaskRun(runId: string): TaskRun | undefined {
    const taskRun = this.taskRuns.get(runId)
    if (!taskRun) return undefined
    if (taskRun.status === 'completed' || taskRun.status === 'failed')
      return taskRun
    const now = new Date()
    const createdAt = new Date(taskRun.created_at!)
    const resolutionTime = createdAt.getTime() + this.timeToResolveMs
    const hasResolved = now.getTime() >= resolutionTime
    if (!hasResolved) return taskRun
    const isSuccess = Math.random() < this.successLikelihood
    const newTaskRun: TaskRun = {
      ...taskRun,
      status: isSuccess ? 'completed' : 'failed',
      modified_at: now.toISOString(),
    }
    if (isSuccess) {
      this.taskRunResults.set(
        runId,
        this.outputFactory(this.taskRunInputs.get(runId)!)
      )
    }
    this.taskRuns.set(runId, newTaskRun)
    return newTaskRun
  }

  /**
   * Get a task run by its ID (must have been created with this client first)
   * @param options - The options for getting a task run
   * @returns The task run
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRun(
    options: GetTaskRunOptions
  ): Promise<GetTaskRunResult> {
    const taskRun = this.accessTaskRun(options.path.run_id)
    if (!taskRun) {
      return {
        data: undefined,
        error: {
          error: {
            message: 'Task run not found',
            ref_id: randomUUID(),
          },
        },
        request: new Request('https://parallel.ai'),
        response: new Response(),
      }
    }
    return {
      data: taskRun,
      error: undefined,
      request: new Request('https://parallel.ai'),
      response: new Response(),
    }
  }

  /**
   * Get the input of a task run by its ID (must have been created with this client first)
   * @param options - The options for getting a task run input
   * @returns The input of the task run
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRunInput(
    options: GetTaskRunInputOptions
  ): Promise<GetTaskRunInputResult> {
    const taskRun = this.accessTaskRun(options.path.run_id)
    const taskRunInput = this.taskRunInputs.get(options.path.run_id)
    if (!taskRunInput || !taskRun) {
      return {
        data: undefined,
        error: {
          error: {
            message: 'Task run input not found',
            ref_id: randomUUID(),
          },
        },
        request: new Request('https://parallel.ai'),
        response: new Response(),
      }
    }
    return {
      data: {
        input: taskRunInput,
        processor: taskRun.processor,
        metadata: taskRun.metadata,
        task_spec: {
          output_schema: this.taskDefinition.output,
          input_schema: this.taskDefinition.input,
        },
      },
      error: undefined,
      request: new Request('https://parallel.ai'),
      response: new Response(),
    }
  }

  /**
   * Get the result of a task run by its ID
   *
   * Results are only available if:
   * - `timeToResolveMs` has passed since task creation
   * - the task run completed successfully (derived from `successLikelihood`)
   *
   * @param options - The options for getting a task run result
   * @returns The result of the task run
   */
  @WrapErrorsIn(ParallelError)
  public async getTaskRunResult(
    options: GetTaskRunResultOptions
  ): Promise<GetTaskRunResultResult> {
    const taskRun = this.accessTaskRun(options.path.run_id)
    const taskRunResult = this.taskRunResults.get(options.path.run_id)
    if (!taskRun || !taskRunResult) {
      return {
        data: undefined,
        error: {
          error: {
            message: 'Task run result not found',
            ref_id: randomUUID(),
          },
        },
        request: new Request('https://parallel.ai'),
        response: new Response(),
      }
    }
    return {
      data: {
        output: { type: 'json', content: taskRunResult, basis: [] },
        run: taskRun,
      },
      error: undefined,
      request: new Request('https://parallel.ai'),
      response: new Response(),
    }
  }
}
