import { z } from 'zod'
import { ParallelProcessor } from './sdk-parallel'

const preprocessInput = (input: unknown) => {
  if (
    typeof input === 'object' &&
    input !== null &&
    'webhook_url' in input &&
    input.webhook_url === undefined
  ) {
    const { webhook_url, ...rest } = input as Record<string, unknown>
    return rest
  }
  return input
}

export const taskRunMetadataZodSchema = z.preprocess(
  preprocessInput,
  z
    .object({
      task_id: z.string(),
      attempt: z.number().optional(),
      webhook_url: z.string().url().optional(), // Make optional
    })
    .and(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
)

export const taskRunStatusWebhookEventZodSchema = z.object({
  timestamp: z.string(),
  type: z.literal('task_run.status'),
  data: z.object({
    run_id: z.string(),
    status: z.enum([
      'queued',
      'action_required',
      'running',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ]),
    is_active: z.boolean(),
    processor: z.nativeEnum(ParallelProcessor),
    created_at: z.string(),
    modified_at: z.string(),
    metadata: taskRunMetadataZodSchema,
  }),
})
