import type { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './routes/auth.js';
import { requireWorkspaceContext } from './auth-context.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerCallRoutes } from './routes/calls.js';
import { registerCallHistoryRoutes } from './routes/call-history.js';
import { registerKnowledgeBaseRoutes } from './routes/knowledge-bases.js';
import { registerToolsRoutes } from './routes/tools.js';
import { registerSipTrunkRoutes } from './routes/sip-trunks.js';
import { registerPhoneNumberRoutes } from './routes/phone-numbers.js';
import { registerOutboundCallRoutes } from './routes/outbound-calls.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerUsageRoutes } from './routes/usage.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerRagRoutes } from './routes/rag.js';
import type { AsteriskController } from '../telephony/asterisk/controller.js';
import { registerTelephonyRoutes } from '../telephony/api/routes.js';
import { registerCallOrchestratorRoutes } from './routes/call-orchestrator.js';

export async function registerApi(app: FastifyInstance, deps?: { asterisk?: AsteriskController }): Promise<void> {
  await app.register(async (router) => {
    await router.register(registerAuthRoutes);

    await router.register(async (protectedRouter) => {
      protectedRouter.addHook('preHandler', requireWorkspaceContext);
      await registerAgentRoutes(protectedRouter);
      await registerCallRoutes(protectedRouter);
      await registerCallHistoryRoutes(protectedRouter);
      await registerKnowledgeBaseRoutes(protectedRouter);
      await registerToolsRoutes(protectedRouter);
      await registerSipTrunkRoutes(protectedRouter);
      await registerPhoneNumberRoutes(protectedRouter);
      await registerOutboundCallRoutes(protectedRouter, { asterisk: deps?.asterisk });
      await registerCallOrchestratorRoutes(protectedRouter);
      await registerWorkspaceRoutes(protectedRouter);
      await registerTeamRoutes(protectedRouter);
      await registerApiKeyRoutes(protectedRouter);
      await registerBillingRoutes(protectedRouter);
      await registerUsageRoutes(protectedRouter);
      await registerAnalyticsRoutes(protectedRouter);
      await registerJobRoutes(protectedRouter);
      await registerWebhookRoutes(protectedRouter);
      await registerRagRoutes(protectedRouter);
      if (deps?.asterisk) registerTelephonyRoutes(protectedRouter, { asterisk: deps.asterisk });
    });
  }, { prefix: '/api/v1' });
}

