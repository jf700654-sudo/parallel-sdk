import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  vi,
} from 'vitest'
import { mock } from 'vitest-mock-extended'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { client } from '../client.gen'
import { Logger } from '../sdk-logging'
import { Parallel } from '../sdk-parallel'

const mockLogger = mock<Logger>()

describe(Parallel.name, () => {
  const server = setupServer()

  beforeAll(() => {
    server.listen()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  it('should set a default base url if none is provided', () => {
    // arrange
    new Parallel({ apiKey: 'test-api-key' })

    // assert
    expect(client.getConfig().baseUrl).toBe('https://api.parallel.ai')
  })

  it('should set the api key, base url, and webhook secret', async () => {
    const webhookUrl = 'http://localhost:3010/webhook'
    const serverHandler = vi.fn()
    const webhookHandler = http.post(
      'http://localhost:3000/v1beta/tasks/runs',
      async ({ request }) => {
        const body = await request.json()
        serverHandler()
        expect(body).toBeDefined()
        expect((body as any).webhook.url).toBe(webhookUrl)
        expect(request.headers.get('x-api-key')).toBe('test-api-key')
        return HttpResponse.json({})
      }
    )
    server.use(webhookHandler)
    const parallel = new Parallel({
      apiKey: 'test-api-key',
      baseUrl: 'http://localhost:3000',
      webhookSecret: 'test-webhook-secret',
      logger: mockLogger,
    })

    // act
    await parallel.createTaskRunWithWebhook({
      body: {
        processor: 'lite',
        webhook: { url: webhookUrl },
        input: { test: 'test' },
      },
    })

    // assert
    expect(serverHandler).toHaveBeenCalled()
  })

  it('should handle each call to the api', async () => {
    // arrange
    const serverHandler = vi.fn()
    const handlers = [
      http.post('http://localhost:3000/v1/tasks/runs', () => {
        serverHandler()
        return HttpResponse.json({})
      }),
      http.get('http://localhost:3000/v1/tasks/runs/123', () => {
        serverHandler()
        return HttpResponse.json({})
      }),
      http.get('http://localhost:3000/v1/tasks/runs/123/input', () => {
        serverHandler()
        return HttpResponse.json({})
      }),
      http.get('http://localhost:3000/v1/tasks/runs/123/result', () => {
        serverHandler()
        return HttpResponse.json({})
      }),
    ] as const
    server.use(...handlers)
    const parallel = new Parallel({
      apiKey: 'test-api-key',
      baseUrl: 'http://localhost:3000',
      logger: mockLogger,
    })

    // act
    await parallel.createTaskRun({
      body: {
        processor: 'lite',
        input: { test: 'test' },
      },
    })
    await parallel.getTaskRun({ path: { run_id: '123' } })
    await parallel.getTaskRunInput({ path: { run_id: '123' } })
    await parallel.getTaskRunResult({ path: { run_id: '123' } })

    // assert
    expect(serverHandler).toHaveBeenCalledTimes(4)
  })
})
