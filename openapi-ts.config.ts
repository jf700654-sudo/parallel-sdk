import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'openapi.yml',
  output: { format: 'prettier', lint: 'eslint', path: './api' },
  plugins: [
    '@hey-api/schemas',
    { name: '@hey-api/typescript', enums: 'javascript' },
    { name: '@hey-api/sdk', asClass: false },
  ],
})
