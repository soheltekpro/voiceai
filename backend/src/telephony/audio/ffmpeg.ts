import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

export async function mp3ToPcm16le8k(mp3: Buffer): Promise<Buffer> {
  const ffmpegPath = ffmpegStatic as unknown as string | null;
  if (!ffmpegPath) throw new Error('ffmpeg-static not available');

  return new Promise<Buffer>((resolve, reject) => {
    const ff = spawn(
      ffmpegPath,
      [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      '8000',
      'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ) as ChildProcessWithoutNullStreams;

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', (d: Buffer) => errChunks.push(d));
    ff.on('error', reject);
    ff.on('close', (code: number | null) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(`ffmpeg failed (${code}): ${Buffer.concat(errChunks).toString('utf8')}`));
    });

    ff.stdin.write(mp3);
    ff.stdin.end();
  });
}

