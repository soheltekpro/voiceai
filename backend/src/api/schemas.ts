import { z } from 'zod';

export const AgentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  agentType: z.enum(['PIPELINE', 'V2V']).optional(),
  systemPrompt: z.string().max(20000).optional(),
  sttProvider: z.string().max(64).optional().nullable(),
  llmProvider: z.string().max(64).optional().nullable(),
  ttsProvider: z.string().max(64).optional().nullable(),
  voice: z.string().max(200).optional(),
  language: z.string().max(32).optional(),
  voiceProvider: z.enum(['OPENAI', 'ELEVENLABS']).optional(),
  maxCallDurationSeconds: z.number().int().min(10).max(24 * 60 * 60).optional(),
  interruptionBehavior: z.enum(['BARGE_IN_STOP_AGENT', 'IGNORE_WHILE_SPEAKING']).optional(),
  knowledgeBaseId: z.string().uuid().optional().nullable(),
});

export const AgentUpdateSchema = AgentCreateSchema.partial();

export const AgentPutSchema = AgentCreateSchema;

export const AgentSettingsUpsertSchema = z.object({
  systemPrompt: z.string().min(1).max(20000).optional(),
  voiceProvider: z.enum(['OPENAI', 'ELEVENLABS']).optional(),
  voiceName: z.string().min(1).max(200).optional(),
  sttProvider: z.string().max(64).optional().nullable(),
  llmProvider: z.string().max(64).optional().nullable(),
  ttsProvider: z.string().max(64).optional().nullable(),
  language: z.string().min(1).max(32).optional(),
  maxCallDurationSeconds: z.number().int().min(10).max(24 * 60 * 60).optional(),
  interruptionBehavior: z.enum(['BARGE_IN_STOP_AGENT', 'IGNORE_WHILE_SPEAKING']).optional(),
  knowledgeBaseId: z.string().uuid().optional().nullable(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ToolTypeEnum = z.enum(['WEBHOOK', 'HTTP_REQUEST', 'DATABASE_LOOKUP', 'HUMAN_HANDOFF']);

export const ToolCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  type: ToolTypeEnum,
  config: z.record(z.unknown()),
});

export const AgentToolsSetSchema = z.object({
  toolIds: z.array(z.string().uuid()).max(50),
});

