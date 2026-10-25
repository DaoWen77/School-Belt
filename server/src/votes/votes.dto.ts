import { z } from 'zod';

/** 契约 §7：POST /cards/:id/vote，单选/多选由 cards.data.multi 决定 */
export const castVoteSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1).max(20),
});
export type CastVoteDto = z.infer<typeof castVoteSchema>;
