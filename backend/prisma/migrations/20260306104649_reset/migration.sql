-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "VoiceProvider" AS ENUM ('OPENAI', 'ELEVENLABS');

-- CreateEnum
CREATE TYPE "InterruptionBehavior" AS ENUM ('BARGE_IN_STOP_AGENT', 'IGNORE_WHILE_SPEAKING');

-- CreateEnum
CREATE TYPE "CallClientType" AS ENUM ('BROWSER', 'PHONE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'ERROR');

-- CreateEnum
CREATE TYPE "CallEventType" AS ENUM ('SESSION_STARTED', 'SESSION_CONNECTED', 'SESSION_ENDED', 'TRANSCRIPT_PARTIAL', 'TRANSCRIPT_FINAL', 'AGENT_TEXT_DELTA', 'AGENT_REPLY', 'AGENT_AUDIO_START', 'AGENT_AUDIO_CHUNK', 'AGENT_AUDIO_END', 'INTERRUPT', 'AGENT_STOPPED', 'ERROR', 'USAGE_UPDATED', 'TOOL_CALLED', 'TOOL_RESULT');

-- CreateEnum
CREATE TYPE "CallMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('PIPELINE', 'V2V');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "WorkspacePlanStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ToolType" AS ENUM ('WEBHOOK', 'HTTP_REQUEST', 'DATABASE_LOOKUP');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ACTIVE', 'ENDED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,4) NOT NULL,
    "callMinutesLimit" INTEGER,
    "tokenLimit" INTEGER,
    "toolCallsLimit" INTEGER,
    "sttSecondsLimit" INTEGER,
    "ttsSecondsLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_plans" (
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "WorkspacePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_plans_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "workspace_usage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agentType" "AgentType" NOT NULL DEFAULT 'PIPELINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ToolType" NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "agentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("agentId","toolId")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "transcript" TEXT,
    "recordingUrl" TEXT,
    "tokensUsed" INTEGER,
    "callSessionId" TEXT,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settings" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL DEFAULT 'You are a helpful voice assistant.',
    "language" TEXT NOT NULL DEFAULT 'en',
    "voiceProvider" "VoiceProvider" NOT NULL DEFAULT 'OPENAI',
    "voiceName" TEXT NOT NULL DEFAULT 'alloy',
    "sttProvider" TEXT,
    "llmProvider" TEXT,
    "ttsProvider" TEXT,
    "maxCallDurationSeconds" INTEGER NOT NULL DEFAULT 900,
    "interruptionBehavior" "InterruptionBehavior" NOT NULL DEFAULT 'BARGE_IN_STOP_AGENT',
    "knowledgeBaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "clientType" "CallClientType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "CallSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "durationSeconds" INTEGER,
    "userMessageCount" INTEGER NOT NULL DEFAULT 0,
    "assistantMessageCount" INTEGER NOT NULL DEFAULT 0,
    "transcriptText" TEXT,
    "estimatedCostUsd" DECIMAL(10,4),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "CallEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "CallMessageRole" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokensEstimated" INTEGER,
    "costUsd" DECIMAL(10,4),

    CONSTRAINT "call_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_trunks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sip_trunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sipTrunkId" TEXT NOT NULL,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhooks_workspaceId_idx" ON "webhooks"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_plans_planId_idx" ON "workspace_plans"("planId");

-- CreateIndex
CREATE INDEX "workspace_usage_workspaceId_idx" ON "workspace_usage"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_usage_workspaceId_periodStart_idx" ON "workspace_usage"("workspaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_usage_workspaceId_metric_periodStart_key" ON "workspace_usage"("workspaceId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_workspaceId_idx" ON "users"("workspaceId");

-- CreateIndex
CREATE INDEX "api_keys_workspaceId_idx" ON "api_keys"("workspaceId");

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "agents_workspaceId_idx" ON "agents"("workspaceId");

-- CreateIndex
CREATE INDEX "agents_agentType_idx" ON "agents"("agentType");

-- CreateIndex
CREATE INDEX "tools_workspaceId_idx" ON "tools"("workspaceId");

-- CreateIndex
CREATE INDEX "calls_workspaceId_idx" ON "calls"("workspaceId");

-- CreateIndex
CREATE INDEX "calls_agentId_idx" ON "calls"("agentId");

-- CreateIndex
CREATE INDEX "calls_startedAt_idx" ON "calls"("startedAt");

-- CreateIndex
CREATE INDEX "calls_status_idx" ON "calls"("status");

-- CreateIndex
CREATE INDEX "calls_callSessionId_idx" ON "calls"("callSessionId");

-- CreateIndex
CREATE INDEX "conversation_messages_callId_createdAt_idx" ON "conversation_messages"("callId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settings_agentId_key" ON "agent_settings"("agentId");

-- CreateIndex
CREATE INDEX "knowledge_bases_workspaceId_idx" ON "knowledge_bases"("workspaceId");

-- CreateIndex
CREATE INDEX "documents_workspaceId_idx" ON "documents"("workspaceId");

-- CreateIndex
CREATE INDEX "documents_knowledgeBaseId_idx" ON "documents"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "call_sessions_agentId_idx" ON "call_sessions"("agentId");

-- CreateIndex
CREATE INDEX "call_sessions_startedAt_idx" ON "call_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "call_sessions_status_startedAt_idx" ON "call_sessions"("status", "startedAt");

-- CreateIndex
CREATE INDEX "call_events_sessionId_timestamp_idx" ON "call_events"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "call_messages_sessionId_createdAt_idx" ON "call_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "sip_trunks_workspaceId_idx" ON "sip_trunks"("workspaceId");

-- CreateIndex
CREATE INDEX "sip_trunks_provider_idx" ON "sip_trunks"("provider");

-- CreateIndex
CREATE INDEX "phone_numbers_workspaceId_idx" ON "phone_numbers"("workspaceId");

-- CreateIndex
CREATE INDEX "phone_numbers_sipTrunkId_idx" ON "phone_numbers"("sipTrunkId");

-- CreateIndex
CREATE INDEX "phone_numbers_agentId_idx" ON "phone_numbers"("agentId");

-- CreateIndex
CREATE INDEX "phone_numbers_number_idx" ON "phone_numbers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_number_sipTrunkId_key" ON "phone_numbers"("number", "sipTrunkId");

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_plans" ADD CONSTRAINT "workspace_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_plans" ADD CONSTRAINT "workspace_plans_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_messages" ADD CONSTRAINT "call_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_trunks" ADD CONSTRAINT "sip_trunks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_sipTrunkId_fkey" FOREIGN KEY ("sipTrunkId") REFERENCES "sip_trunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
