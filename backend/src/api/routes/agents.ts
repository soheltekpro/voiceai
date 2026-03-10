import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { getPromptOptimizations, generatePromptOptimization } from '../../voice/prompt-optimizer.js';
import {
  createPromptVersion,
  listPromptVersions,
  getPromptPerformance,
  setPromptVersionActive,
  setPromptVersionTrafficShare,
} from '../../voice/prompt-version.js';
import {
  AgentCreateSchema,
  AgentSettingsUpsertSchema,
  AgentUpdateSchema,
  AgentPutSchema,
  PaginationSchema,
} from '../schemas.js';

/** Normalize agent + settings for response (includes schema: id, name, description, agent_type, system_prompt, stt_provider, llm_provider, tts_provider, voice, language, created_at). */
function toAgentResponse(
  agent: {
    id: string;
    name: string;
    description: string | null;
    agentType: string;
    createdAt: Date;
    updatedAt: Date;
    settings: {
      systemPrompt: string;
      language: string;
      voiceName: string;
      voiceProvider: string;
      sttProvider: string | null;
      sttModel: string | null;
      llmProvider: string | null;
      llmModel: string | null;
      ttsProvider: string | null;
      ttsVoice: string | null;
      temperature: number | null;
      knowledgeBaseId: string | null;
    } | null;
  } | null
) {
  if (!agent) return null;
  const s = agent.settings;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    agent_type: agent.agentType,
    agentType: agent.agentType,
    system_prompt: s?.systemPrompt ?? null,
    systemPrompt: s?.systemPrompt ?? null,
    stt_provider: s?.sttProvider ?? null,
    sttProvider: s?.sttProvider ?? null,
    stt_model: s?.sttModel ?? null,
    sttModel: s?.sttModel ?? null,
    llm_provider: s?.llmProvider ?? null,
    llmProvider: s?.llmProvider ?? null,
    llm_model: s?.llmModel ?? null,
    llmModel: s?.llmModel ?? null,
    tts_provider: s?.ttsProvider ?? null,
    ttsProvider: s?.ttsProvider ?? null,
    tts_voice: s?.ttsVoice ?? null,
    ttsVoice: s?.ttsVoice ?? null,
    voice: s?.voiceName ?? null,
    voiceName: s?.voiceName ?? null,
    temperature: s?.temperature ?? null,
    language: s?.language ?? null,
    knowledgeBaseId: s?.knowledgeBaseId ?? null,
    created_at: agent.createdAt.toISOString(),
    createdAt: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    settings: agent.settings,
  };
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const { limit, offset } = PaginationSchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.agent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { settings: true },
      }),
      prisma.agent.count({ where: { workspaceId } }),
    ]);
    return {
      items: items.map((a) => toAgentResponse(a)),
      total,
      limit,
      offset,
    };
  });

  app.post('/agents', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = AgentCreateSchema.parse(req.body);
    const agent = await prisma.agent.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        agentType: body.agentType ?? 'PIPELINE',
        settings: {
          create: {
            systemPrompt: body.systemPrompt ?? 'You are a helpful voice assistant.',
            language: body.language ?? 'en',
            voiceName: body.voice ?? 'alloy',
            voiceProvider: body.voiceProvider ?? 'OPENAI',
            sttProvider: body.sttProvider ?? null,
            sttModel: body.sttModel ?? null,
            llmProvider: body.llmProvider ?? null,
            llmModel: body.llmModel ?? null,
            ttsProvider: body.ttsProvider ?? null,
            ttsVoice: body.ttsVoice ?? null,
            temperature: body.temperature ?? null,
            maxCallDurationSeconds: body.maxCallDurationSeconds ?? 900,
            interruptionBehavior: body.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT',
            knowledgeBaseId: body.knowledgeBaseId ?? null,
          },
        },
      },
      include: { settings: true },
    });
    return reply.code(201).send(toAgentResponse(agent));
  });

  app.get('/agents/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, include: { settings: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    return toAgentResponse(agent);
  });

  app.patch('/agents/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const body = AgentUpdateSchema.parse(req.body);
    const existing = await prisma.agent.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.code(404).send({ message: 'Agent not found' });
    try {
      const agent = await prisma.agent.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.agentType !== undefined ? { agentType: body.agentType } : {}),
        },
        include: { settings: true },
      });
      if (body.systemPrompt !== undefined || body.voice !== undefined || body.language !== undefined || body.sttProvider !== undefined || body.sttModel !== undefined || body.llmProvider !== undefined || body.llmModel !== undefined || body.ttsProvider !== undefined || body.ttsVoice !== undefined || body.temperature !== undefined || body.voiceProvider !== undefined || body.maxCallDurationSeconds !== undefined || body.interruptionBehavior !== undefined || body.knowledgeBaseId !== undefined) {
        await prisma.agentSettings.upsert({
          where: { agentId: id },
          create: {
            agentId: id,
            systemPrompt: body.systemPrompt ?? 'You are a helpful voice assistant.',
            language: body.language ?? 'en',
            voiceName: body.voice ?? 'alloy',
            voiceProvider: body.voiceProvider ?? 'OPENAI',
            sttProvider: body.sttProvider ?? null,
            sttModel: body.sttModel ?? null,
            llmProvider: body.llmProvider ?? null,
            llmModel: body.llmModel ?? null,
            ttsProvider: body.ttsProvider ?? null,
            ttsVoice: body.ttsVoice ?? null,
            temperature: body.temperature ?? null,
            maxCallDurationSeconds: body.maxCallDurationSeconds ?? 900,
            interruptionBehavior: body.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT',
            knowledgeBaseId: body.knowledgeBaseId ?? null,
          },
          update: {
            ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
            ...(body.language !== undefined ? { language: body.language } : {}),
            ...(body.voice !== undefined ? { voiceName: body.voice } : {}),
            ...(body.voiceProvider !== undefined ? { voiceProvider: body.voiceProvider } : {}),
            ...(body.sttProvider !== undefined ? { sttProvider: body.sttProvider } : {}),
            ...(body.sttModel !== undefined ? { sttModel: body.sttModel } : {}),
            ...(body.llmProvider !== undefined ? { llmProvider: body.llmProvider } : {}),
            ...(body.llmModel !== undefined ? { llmModel: body.llmModel } : {}),
            ...(body.ttsProvider !== undefined ? { ttsProvider: body.ttsProvider } : {}),
            ...(body.ttsVoice !== undefined ? { ttsVoice: body.ttsVoice } : {}),
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
            ...(body.maxCallDurationSeconds !== undefined ? { maxCallDurationSeconds: body.maxCallDurationSeconds } : {}),
            ...(body.interruptionBehavior !== undefined ? { interruptionBehavior: body.interruptionBehavior } : {}),
            ...(body.knowledgeBaseId !== undefined ? { knowledgeBaseId: body.knowledgeBaseId ?? null } : {}),
          },
        });
        const updated = await prisma.agent.findUnique({ where: { id }, include: { settings: true } });
        return toAgentResponse(updated!);
      }
      return toAgentResponse(agent);
    } catch {
      return reply.code(404).send({ message: 'Agent not found' });
    }
  });

  app.put('/agents/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const body = AgentPutSchema.parse(req.body);
    const exists = await prisma.agent.findFirst({ where: { id, workspaceId }, include: { settings: true } });
    if (!exists) return reply.code(404).send({ message: 'Agent not found' });
    try {
      await prisma.agent.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description ?? null,
          agentType: body.agentType ?? 'PIPELINE',
        },
      });
      await prisma.agentSettings.upsert({
        where: { agentId: id },
        create: {
          agentId: id,
          systemPrompt: body.systemPrompt ?? 'You are a helpful voice assistant.',
          language: body.language ?? 'en',
          voiceName: body.voice ?? 'alloy',
          voiceProvider: body.voiceProvider ?? 'OPENAI',
          sttProvider: body.sttProvider ?? null,
          sttModel: body.sttModel ?? null,
          llmProvider: body.llmProvider ?? null,
          llmModel: body.llmModel ?? null,
          ttsProvider: body.ttsProvider ?? null,
          ttsVoice: body.ttsVoice ?? null,
          temperature: body.temperature ?? null,
          maxCallDurationSeconds: body.maxCallDurationSeconds ?? 900,
          interruptionBehavior: body.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT',
          knowledgeBaseId: body.knowledgeBaseId ?? null,
        },
        update: {
          systemPrompt: body.systemPrompt ?? exists.settings?.systemPrompt ?? 'You are a helpful voice assistant.',
          language: body.language ?? exists.settings?.language ?? 'en',
          voiceName: body.voice ?? exists.settings?.voiceName ?? 'alloy',
          voiceProvider: body.voiceProvider ?? exists.settings?.voiceProvider ?? 'OPENAI',
          sttProvider: body.sttProvider ?? exists.settings?.sttProvider ?? null,
          sttModel: body.sttModel ?? exists.settings?.sttModel ?? null,
          llmProvider: body.llmProvider ?? exists.settings?.llmProvider ?? null,
          llmModel: body.llmModel ?? exists.settings?.llmModel ?? null,
          ttsProvider: body.ttsProvider ?? exists.settings?.ttsProvider ?? null,
          ttsVoice: body.ttsVoice ?? exists.settings?.ttsVoice ?? null,
          temperature: body.temperature ?? exists.settings?.temperature ?? null,
          maxCallDurationSeconds: body.maxCallDurationSeconds ?? exists.settings?.maxCallDurationSeconds ?? 900,
          interruptionBehavior: body.interruptionBehavior ?? exists.settings?.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT',
          knowledgeBaseId: body.knowledgeBaseId ?? exists.settings?.knowledgeBaseId ?? null,
        },
      });
      const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, include: { settings: true } });
      return toAgentResponse(agent!);
    } catch {
      return reply.code(404).send({ message: 'Agent not found' });
    }
  });

  app.delete('/agents/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    try {
      const { count } = await prisma.agent.deleteMany({ where: { id, workspaceId } });
      if (count === 0) return reply.code(404).send({ message: 'Agent not found' });
      return reply.code(204).send();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2003' || (err as Error).message?.includes('foreign key')) {
        return reply.code(409).send({
          message: 'Cannot delete agent: it is referenced by calls or other records. Remove or reassign those first.',
        });
      }
      throw err;
    }
  });

  app.get('/agents/:id/settings', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, include: { settings: true } });
    if (!agent?.settings) return reply.code(404).send({ message: 'Settings not found' });
    return agent.settings;
  });

  app.put('/agents/:id/settings', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const body = AgentSettingsUpsertSchema.parse(req.body);
    const exists = await prisma.agent.findFirst({ where: { id, workspaceId } });
    if (!exists) return reply.code(404).send({ message: 'Agent not found' });

    const settings = await prisma.agentSettings.upsert({
      where: { agentId: id },
      create: { agentId: id, ...body },
      update: { ...body },
    });
    return settings;
  });

  /** GET /api/v1/agents/:id/prompt-optimization — latest AI prompt suggestions for this agent */
  app.get('/agents/:id/prompt-optimization', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const limit = Math.min(50, Math.max(1, Number((req.query as { limit?: string }).limit) || 20));
    const items = await getPromptOptimizations(id, limit);
    return { items };
  });

  /** POST /api/v1/agents/:id/prompt-optimization — generate a new suggestion from recent call evaluations */
  app.post('/agents/:id/prompt-optimization', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const result = await generatePromptOptimization(id);
    if (!result) return reply.code(422).send({ message: 'Insufficient call evaluations or generation failed' });
    return result;
  });

  /** POST /api/v1/agents/:id/prompt-version — create a new prompt version (A/B testing) */
  app.post('/agents/:id/prompt-version', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const body = (req.body as { systemPrompt?: string; isActive?: boolean; trafficShare?: number }) ?? {};
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    if (!systemPrompt) return reply.code(400).send({ message: 'systemPrompt is required' });
    const created = await createPromptVersion(workspaceId, id, systemPrompt, {
      isActive: body.isActive,
      trafficShare: body.trafficShare,
    });
    return reply.code(201).send(created);
  });

  /** GET /api/v1/agents/:id/prompt-versions — list prompt versions for this agent */
  app.get('/agents/:id/prompt-versions', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const items = await listPromptVersions(id);
    return { items };
  });

  /** GET /api/v1/agents/:id/prompt-performance — conversion rate, avg score, duration per version */
  app.get('/agents/:id/prompt-performance', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const items = await getPromptPerformance(id);
    return { items };
  });

  /** PATCH /api/v1/agents/:id/prompt-versions/:versionId — enable/disable or set traffic share */
  app.patch('/agents/:id/prompt-versions/:versionId', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const agentId = (req.params as { id: string }).id;
    const versionId = (req.params as { versionId: string }).versionId;
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const version = await prisma.voicePromptVersion.findFirst({
      where: { id: versionId, agentId },
      select: { id: true },
    });
    if (!version) return reply.code(404).send({ message: 'Prompt version not found' });
    const body = (req.body as { isActive?: boolean; trafficShare?: number }) ?? {};
    if (typeof body.isActive === 'boolean') await setPromptVersionActive(versionId, body.isActive);
    if (typeof body.trafficShare === 'number') await setPromptVersionTrafficShare(versionId, body.trafficShare);
    const updated = await prisma.voicePromptVersion.findUnique({
      where: { id: versionId },
      select: { id: true, version: true, systemPrompt: true, isActive: true, trafficShare: true, createdAt: true },
    });
    return updated ?? reply.code(404).send({ message: 'Version not found' });
  });
}

