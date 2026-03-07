export type RtpPacket = {
  version: number;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payload: Buffer;
};

export function parseRtpPacket(buf: Buffer): RtpPacket | null {
  if (buf.length < 12) return null;
  const vpxcc = buf.readUInt8(0);
  const version = vpxcc >> 6;
  if (version !== 2) return null;
  const csrcCount = vpxcc & 0x0f;
  const markerPayload = buf.readUInt8(1);
  const payloadType = markerPayload & 0x7f;
  const sequenceNumber = buf.readUInt16BE(2);
  const timestamp = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);
  const headerLen = 12 + csrcCount * 4;
  if (buf.length < headerLen) return null;
  const payload = buf.subarray(headerLen);
  return { version, payloadType, sequenceNumber, timestamp, ssrc, payload };
}

export function buildRtpPacket(params: {
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker?: boolean;
  payload: Buffer;
}): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt8(0x80, 0); // V=2, P=0, X=0, CC=0
  header.writeUInt8((params.marker ? 0x80 : 0x00) | (params.payloadType & 0x7f), 1);
  header.writeUInt16BE(params.sequenceNumber & 0xffff, 2);
  header.writeUInt32BE(params.timestamp >>> 0, 4);
  header.writeUInt32BE(params.ssrc >>> 0, 8);
  return Buffer.concat([header, params.payload]);
}

