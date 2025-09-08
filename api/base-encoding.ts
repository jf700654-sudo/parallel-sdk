import { ParallelError } from './sdk-errors'

export const normalizeBase64Padding = (input: string): string => {
  // Convert URL-safe Base64 to standard Base64
  const standardBase64 = input.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  const remainder = standardBase64.length % 4
  if (remainder === 2) return standardBase64 + '=='
  if (remainder === 3) return standardBase64 + '='
  if (remainder === 1) throw new ParallelError('Invalid base64 string')
  return standardBase64
}
