# Parallel

[Get familiar with Parallel's service offering and capabilities at their docs](https://docs.parallel.ai/introduction/overview)

## Installation

```sh
npm install @owner.com/parallel-sdk
```

```sh
yarn add @owner.com/parallel-sdk
```

```sh
pnpm add @owner.com/parallel-sdk
```

## Getting started

First, initialize a new `Parallel` instance:

```ts
const parallel = new Parallel({apiKey: 'your-api-key'})
```

You can access all available Parallel endpoints via this instance:

```ts
await parallel.createTaskRun({
  body: {
    input: 'Who is the president of France?',
    processor: ParallelProcessor.Base,
    task_spec: {
      input_schema: {
        type: 'text',
        description: 'A question you should answer',
      },
      output_schema: {
        json_schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          type: 'object',
          properties: {name: {type: 'string'}, age: {type: 'number'}},
          required: ['name', 'age'],
        },
        type: 'json',
      },
    },
    metadata: {foo: 'bar'},
  },
})
```

## Using tasks

As an abstraction, this package provides `ParallelTaskDefinition`, which works with `Parallel` to provide a fully typed
experience for defining and resolving task runs.

> [!NOTE]
> Parallel does not actually have a defined entity for a `Task`, only for `TaskRun`s. The concept of a task is an
> opinion that exists purely in this library to make working with `TaskRun`s easier. It also makes `Task`s extremely
> flexible, since they only exist in your runtime code.

You can define tasks in just a few lines:

```ts
const getBrandLogoParallelTask = new ParallelTaskDefinition({
  identifier: 'get-brand-logo',
  input: new ZodParallelTaskJsonIO({
    description: 'url',
    schema: z.object({url: z.string()}),
  }),
  output: new ZodParallelTaskJsonIO({
    description: 'logo',
    schema: z.object({logoUrl: z.string()}),
  }),
  metadata: new ZodParallelTaskMetadata(z.object({foo: z.string()})),
  defaultProcessor: ParallelProcessor.Core,
})
```

Now, you can start a task using the `input` schema defined in `getBrandLogoParallelTask`.

```ts
const taskRun = await getBrandLogoParallelTask.startRun(
  {
    input: {url: 'https://example.com'},
    metadata: {foo: 'bar'},
    processor: ParallelProcessor.Base, // optional - default is tasks `defaultProcessor`
  },
  parallel
)
```

Tasks are resolved asynchronously in Parallel and can take >10 mins. To check the status of a task:

```ts
//    vv check taskRun.status
const taskRun = await getBrandLogoParallelTask.getRun(taskRun.run_id, parallel)
```

Once a task run's status is `completed`, you can get the result:

```ts
//    vv output is typed and parsed for you
const output = await getBrandLogoParallelTask.getRunOutput(
  taskRun.run_id,
  parallel
)
```

If you want to resolve the run synchronously, you can use `pollForRunOutput` (although this is not recommended for
slower processors):

```ts
const output = await getBrandLogoParallelTask.pollForRunOutput(
  taskRun.run_id,
  parallel,
  {timeoutMs: 1000, intervalMs: 100, backoffExponent: 1.5}
  // ^^ all this configuration is optional - if left blank, sane defaults will be set based on the run processor
)
```

## Using webhooks

> [!NOTE]
> Remember that to receive webhook events, you need to use `parallel.createTaskRunWithWebhook` from the stock client or
> add the `webhook` property if consuming `task.startRun`.

Support for webhooks is made easy via the `ParallelWebhookHandler` class. Inside an endpoint, you can use an instance of
this class to verify and parse the event payload. Verification uses the `Parallel` client's `webhookSecret` value under
the hood to check the payload is directly from Parallel.

```ts
const parallel = new Parallel({
  apiKey: 'api-key',
  webhookSecret: 'webhook-secret',
})
const webhookHandler = new ParallelWebhookHandler()
const payload = 'request.body'
const webhookSignature = 'request.headers.webhook-signature'
const webhookId = 'request.headers.webhook-id'
const webhookTimestamp = 'request.headers.webhook-timestamp'
const verified = await webhookHandler.verifyWebhookSecret(
  {payload, webhookSignature, webhookId, webhookTimestamp},
  parallel
)
if (!verified) throw new Error()
const event = webhookHandler.parseWebhookEvent(body)
```

### Integrating with task definitions

The `ParallelWebhookHandler` can take 0-n `ParallelTaskWebhook`s in its constructor. Using `handleTaskWebhook`
enables you to conveniently route the `event` to the handling logic for the task it originated from. If the run was
successful, `ParallelWebhookHandler` will automatically fetch the output for you, parse it and pipe it into the task
definitions handler.

```ts
const getBrandLogoParallelTaskWebhook = new ParallelTaskWebhook({
  taskDefinition: getBrandLogoParallelTask,
  onSuccess: (output, taskRun) => console.log(output, taskRun),
})

const webhookHandler = new ParallelWebhookHandler({
  taskWebhooks: [getBrandLogoParallelTaskWebhook],
})

// ... same verification and parsing logic as example above
await webhookHandler.handleTaskWebhook(event, parallel)
```

### Success and failure callbacks

All task webhooks allow you to set optional success and failure handlers that get triggered in webhooks via `onSuccess`
and `onFailure`.

```ts
const getBrandLogoParallelWebhook = new ParallelTaskWebhook({
  // other properties hidden for brevity
  onSuccess: (output, taskRun) => console.log(output, taskRun),
  onFailure: (taskRun) => console.error(taskRun),
})
```

By default, `ParallelWebhookHandler` will run `onSuccess` when processing a task run event with a `success` status and
`onFailure` when processing a task run event with a `failed` status.

Sometimes, you might want to count some "successful" results as failures. Task definitions support this via the
`outputIsFailure` callback. If this function is declared, `success` status outputs will be piped into this function
before running `onSuccess/onFailure`, going to the former if the result is false, and the latter if the result is true.

```ts
const getBrandLogoParallelWebhook = new ParallelTaskWebhook({
  // other properties hidden for brevity
  onSuccess: (output, taskRun) => console.log(output, taskRun),
  onFailure: (taskRun) => console.error(taskRun),
  // JSON Schema doesn't support URL compliance, so we'll do it here
  // Will pipe to `onFailure` if parsing fails, or `onSuccess` if it succeeds
  outputIsFailure: (output, taskRun) =>
    !z.string().url().safeParse(output.logoUrl).success,
})
```

### Retries

Task webhooks also support retries via `retries`. You can configure it in two ways. One, is simply setting a number of
retries to do before giving up.

```ts
const getBrandLogoParallelTask = new ParallelTaskDefinition({
  // other properties hidden for brevity
  defaultProcessor: ParallelProcessor.Core,
})

const getBrandLogoParallelWebhook = new ParallelTaskWebhook({
  // other properties hidden for brevity
  onSuccess: (output, taskRun) => console.log(output, taskRun),
  retries: 3,
})
```

In this configuration, if the initial run fails, the webhook handler will retry the task up to two additional runs.

You can also use the more advanced retry behavior, which allows you to configure a number of retires for different
models, with automatic upgrades:

```ts
const getBrandLogoParallelWebhook = new ParallelTaskWebhook({
  // other properties hidden for brevity
  defaultProcessor: ParallelProcessor.Base,
  onSuccess: (output, taskRun) => console.log(output, taskRun),
  retries: {
    [ParallelProcessor.Base]: 2,
    [ParallelProcessor.Core]: 1,
    [ParallelProcessor.Pro]: 1,
    [ParallelProcessor.Ultra]: 1,
  },
})
```

In this configuration, if the initial run fails, it will retry on the base model once. If that run fails, it will
upgrade and retry on the core model, then the pro model, and then the ultra model, one time on each. If a success is
ever encountered, it will stop retrying.

All retry state is stored in the task run's metadata, so retries are totally asynchronous.

### Testing webhooks locally

To test webhooks using local endpoints, extract the webhook URL to an `.env` variable and use a local tunnelling service
like [`ngrok`](https://ngrok.com/docs/getting-started/) or [`localhost.run`](https://localhost.run/docs/) to make your
server available to Parallel.

## Mocking

This package has been designed with easy mocking in mind. Since abstractions rely on `IParallel`, you can easily inject
a mocked, type-safe `jest`/`vi` function into your application logic in tests.

```ts
const mockParallel = mock<IParallel>()
mockParallel.getTaskRunResult.mockResolvedValueOnce({
  // ... data here
})
await taskDefinition.getRunOutput('123', mockParallel)
```

If you are working with instances of `ParallelTaskDefinition`, this package exports `MockParallelForTaskDefinition`,
which makes it easy to fully simulate the behaviors of the Parallel server.

```ts
// arrange
const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
  outputFactory: (input) => ({logoUrl: input.url + '/test'}),
  successLikelihood: 1,
  timeToResolveMs: 30,
})

// act
const taskRun = await taskDefinition.startRun(
  {
    input: {url: 'https://example.com'},
    processor: ParallelProcessor.Base,
    metadata: {foo: 'bar'},
  },
  mockParallel
)
const result = await taskDefinition.pollForRunOutput(
  taskRun.run_id,
  mockParallel,
  {timeoutMs: 100, intervalMs: 10, backoffExponent: 1}
)

// assert
expect(result).toEqual({logoUrl: 'https://example.com'})
```

Under the hood, the resolution to tasks called with `mockParallel` will always be available exactly `timeToResolveMs`
after `startRun` is called, and after this time, success if determined based on `successLikelihood`, returning a call to
`outputFactory` with the original input injected if true.

To simulate webhook handling using `MockParallelForTaskDefinition`, you can pass in a `ParallelWebhookHandler` instance:

```ts
const webhookHandler = new ParallelWebhookHandler({
  taskWebhooks: [taskWebhook],
})
const mockParallel = new MockParallelForTaskDefinition(taskDefinition, {
  outputFactory: (input) => ({logoUrl: input.url + '/test'}),
  successLikelihood: 1,
  timeToResolveMs: 30,
})
```

When you do so, if calls in your application logic specify webhook handling, the webhook handler will subscribe to a
mocked event stream with a delay of `timeToResolve`.

```ts
// act
const taskRun = await taskDefinition.startRun(
  {
    input: {url: 'https://example.com'},
    processor: ParallelProcessor.Base,
    metadata: {foo: 'bar'},
    webhook: {url: new URL('http://localhost:3000')},
    // ^^ will call taskDefinition's webhook onSuccess callback in 30ms
  },
  mockParallel
)
```

This event bus resolves synchronously, so you don't need to block the thread in tests.
