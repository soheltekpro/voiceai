import { VoiceAIClient, type VoiceAIOptions } from './client.js';
import { CallsResource } from './calls.js';
import { AgentsResource } from './agents.js';
import { KnowledgeResource } from './knowledge.js';
import { webhooks } from './webhooks.js';

export class VoiceAI {
  private client: VoiceAIClient;

  readonly calls: CallsResource;
  readonly agents: AgentsResource;
  readonly knowledge: KnowledgeResource;
  readonly webhooks = webhooks;

  constructor(opts: VoiceAIOptions) {
    this.client = new VoiceAIClient(opts);
    this.calls = new CallsResource(this.client);
    this.agents = new AgentsResource(this.client);
    this.knowledge = new KnowledgeResource(this.client);
  }
}

export type { VoiceAIOptions } from './client.js';
export { VoiceAIClient, VoiceAIHttpError } from './client.js';
export * as Webhooks from './webhooks.js';
export * as Calls from './calls.js';
export * as Agents from './agents.js';
export * as Knowledge from './knowledge.js';

