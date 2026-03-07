# voiceai-sdk

Node.js SDK for the Voice AI platform.

## Install

```bash
npm install voiceai-sdk
```

## Usage

```ts
import { VoiceAI } from 'voiceai-sdk';

const voiceai = new VoiceAI({
  apiKey: process.env.VOICEAI_API_KEY!,
  baseUrl: 'http://localhost:3000',
});

const agents = await voiceai.agents.list({ limit: 20, offset: 0 });
const call = await voiceai.calls.start({ agentId: agents.items[0].id });

if ('jobId' in call) {
  // Call start was queued (workers not available yet)
  console.log('queued', call.jobId);
} else {
  console.log('started', call.engine, call.callSessionId);
}
```

## Webhook signature verification

Your webhook receiver should compute the HMAC over the **raw request body**.

```ts
import { VoiceAI } from 'voiceai-sdk';

const voiceai = new VoiceAI({ apiKey: process.env.VOICEAI_API_KEY! });
const ok = voiceai.webhooks.verifySignature({
  secret: process.env.WEBHOOK_SECRET!,
  payload: rawBodyString,
  signature: req.headers['x-voiceai-signature'] as string,
});
```

Or:

```ts
import { webhooks } from 'voiceai-sdk';

const ok = webhooks.verifySignature({
  secret: process.env.WEBHOOK_SECRET!,
  payload: rawBodyString,
  signature: req.headers['x-voiceai-signature'] as string,
});
```

