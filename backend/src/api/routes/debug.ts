import type { FastifyInstance } from 'fastify';
import { getCallTrace } from '../../voice/call-trace.js';

export async function registerDebugRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { callId: string } }>('/debug/calls/:callId', async (req, reply) => {
    const { callId } = req.params;
    const trace = getCallTrace(callId);
    if (!trace) {
      return reply.status(404).send({ error: 'Call trace not found', callId });
    }
    return reply.send({
      callId: trace.callId,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      sttLatencyMs: trace.sttLatencyMs,
      llmFirstTokenMs: trace.llmFirstTokenMs,
      llmTotalDurationMs: trace.llmTotalDurationMs,
      ttsFirstAudioMs: trace.ttsFirstAudioMs,
      ttsTotalDurationMs: trace.ttsTotalDurationMs,
      totalTurnLatencyMs: trace.totalTurnLatencyMs,
      providerUsed: trace.providerUsed,
    });
  });
}
