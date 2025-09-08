import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
      reportOnFailure: true,
      include: [
        'api/sdk-webhook.ts',
        'api/sdk-task-definition.ts',
        'api/sdk-parallel.ts',
        'api/sdk-mocks.ts',
        'api/sdk-errors.ts',
        'api/base-encoding.ts',
      ],
    },
  },
})
