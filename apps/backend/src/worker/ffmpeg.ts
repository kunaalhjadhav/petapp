import { spawn } from 'child_process';

export interface Probe {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/** Reads the real container contents; the uploaded MIME type is not trusted. */
export async function probe(file: string): Promise<Probe> {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 60_000));
  const streams: Array<{ codec_type: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }> = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('No video stream found');
  const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  const [width, height] = rotation === 90 ? [video.height, video.width] : [video.width, video.height];
  return {
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    width,
    height,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Scales so the SHORT side is at most `n` (works for portrait reels and landscape video). */
const shortSide = (n: number) => `scale='if(gt(iw,ih),-2,min(${n},iw))':'if(gt(iw,ih),min(${n},ih),-2)'`;

/**
 * Two-rendition HLS (720p / 360p by short side), 4-second aligned segments, metadata stripped.
 * Output: {outDir}/master.m3u8, {outDir}/v0/…, {outDir}/v1/…
 */
export async function transcodeHls(input: string, outDir: string, hasAudio: boolean): Promise<void> {
  const args = ['-y', '-i', input, '-map_metadata', '-1', '-map_chapters', '-1',
    '-filter_complex', `[0:v]split=2[a][b];[a]${shortSide(720)}[v0];[b]${shortSide(360)}[v1]`,
    '-map', '[v0]', '-map', '[v1]'];
  if (hasAudio) args.push('-map', '0:a:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v:0', '2500k', '-maxrate:v:0', '2700k', '-bufsize:v:0', '5000k',
    '-b:v:1', '700k', '-maxrate:v:1', '760k', '-bufsize:v:1', '1400k',
    '-force_key_frames', 'expr:gte(t,n_forced*4)',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
    '-hls_segment_filename', `${outDir}/v%v/seg_%03d.ts`,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', hasAudio ? 'v:0,a:0 v:1,a:1' : 'v:0 v:1',
    `${outDir}/v%v/index.m3u8`,
  );
  await run('ffmpeg', args, 15 * 60_000);
}

export async function posterFrame(input: string, out: string, durationMs: number): Promise<void> {
  const at = Math.min(1, durationMs / 2000).toFixed(2);
  await run('ffmpeg', ['-y', '-ss', at, '-i', input, '-frames:v', '1', '-map_metadata', '-1', '-vf', shortSide(720), '-q:v', '3', out], 60_000);
}
