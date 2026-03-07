import ari from 'ari-client';

export type AriConfig = {
  url: string; // e.g. http://localhost:8088
  username: string;
  password: string;
  appName: string; // e.g. voiceai
};

export async function connectAri(cfg: AriConfig): Promise<any> {
  const client = await new Promise<any>((resolve, reject) => {
    ari.connect(cfg.url, cfg.username, cfg.password, (err: any, c: any) => {
      if (err) return reject(err);
      resolve(c);
    });
  });
  return client;
}

