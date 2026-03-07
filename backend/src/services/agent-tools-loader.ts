/**
 * Load tools linked to an agent for LLM tool-calling.
 */

import { prisma } from '../db/prisma.js';

export type ToolDef = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
};

export async function loadToolsForAgent(agentId: string): Promise<ToolDef[]> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { agentTools: { include: { tool: true } } },
  });
  if (!agent) return [];
  return agent.agentTools.map((at) => ({
    id: at.tool.id,
    name: at.tool.name,
    description: at.tool.description,
    type: at.tool.type,
    config: (at.tool.config as Record<string, unknown>) || {},
  }));
}
