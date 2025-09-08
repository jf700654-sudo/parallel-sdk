import { normalizeBase64Padding } from '../base-encoding'
import { ParallelError } from '../sdk-errors'
import { describe, expect, it } from 'vitest'

describe(normalizeBase64Padding.name, () => {
  it('should normalize base64 padding', () => {
    expect(normalizeBase64Padding('test')).toBe('test')
    expect(normalizeBase64Padding('test==')).toBe('test====')
    expect(normalizeBase64Padding('test===')).toBe('test====')
  })

  it('should throw an error if the input is not a valid base64 string', () => {
    expect(() => normalizeBase64Padding('t')).toThrow(ParallelError)
  })

  it('should be url safe', () => {
    expect(normalizeBase64Padding('testing-')).toBe('testing+')
    expect(normalizeBase64Padding('testing_')).toBe('testing/')
    expect(normalizeBase64Padding('testing+')).toBe('testing+')
    expect(normalizeBase64Padding('testing/')).toBe('testing/')
  })
})
