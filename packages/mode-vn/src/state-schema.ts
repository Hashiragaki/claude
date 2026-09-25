import type { Value } from '@forge/core';
import { z } from 'zod';

const ValueSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(ValueSchema), z.record(z.string(), ValueSchema)]),
);

const SpeakerSchema = z.object({ name: z.string(), color: z.string().nullable() }).nullable();

/** Validation d'une sauvegarde VN (données venant du stockage : non fiables). */
export const VNSaveStateSchema = z.object({
  pc: z.number().int().nonnegative(),
  callStack: z.array(z.number().int().nonnegative()),
  vars: z.record(z.string(), ValueSchema),
  scene: z.object({
    background: z.string().nullable(),
    images: z.array(
      z.object({ tag: z.string(), attrs: z.array(z.string()), position: z.string(), ref: z.string() }),
    ),
  }),
  audio: z.object({ music: z.string().optional(), sound: z.string().optional(), voice: z.string().optional() }),
  windowShown: z.boolean(),
  scriptHash: z.string(),
  anchors: z.array(z.object({ label: z.string(), offset: z.number().int() }).nullable()).optional(),
  history: z
    .array(z.object({ speaker: SpeakerSchema, text: z.string(), choice: z.boolean().optional() }))
    .optional(),
});
