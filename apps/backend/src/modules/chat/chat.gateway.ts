import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { Gauge } from 'prom-client';
import { WebSocket, WebSocketServer } from 'ws';
import { MetricsService } from '../../observability/metrics';
import { RbacService } from '../rbac/rbac.service';
import { ChatRealtime } from './chat.realtime';
import { ChatService } from './chat.service';
import { parseClientCommand, type ChatEvent } from './chat.rules';

export const CHAT_WS_PATH = '/api/v1/chat/ws';
const HEARTBEAT_MS = 25_000;
const MAX_SOCKETS_PER_USER = 10;
const TYPING_EVERY_MS = 2_000;

interface Client {
  ws: WebSocket;
  userId: string;
  alive: boolean;
  /** Conversations this socket may signal typing in (checked once, kept a minute). */
  typing: Map<string, { side: 'CUSTOMER' | 'BUSINESS'; to: string[]; until: number; last: number }>;
}

/**
 * Live delivery for chat. Apps connect to `/api/v1/chat/ws?ticket=…` with a one-time ticket from
 * `POST /chat/realtime-ticket`. The socket only receives events (new messages, read receipts, typing, status) and
 * accepts two commands: `ping` and `typing`. Sending a message is always an HTTP request, so it is validated,
 * rate-limited and stored before anyone sees it. Any instance can serve any person: events fan out through Redis.
 */
@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private readonly logger = new Logger(ChatGateway.name);
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<string, Set<Client>>();
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly realtime: ChatRealtime,
    private readonly chat: ChatService,
    private readonly rbac: RbacService,
    metrics: MetricsService,
  ) {
    const clients = this.clients;
    const existing = metrics.registry.getSingleMetric('petapp_chat_connections');
    if (!existing) {
      new Gauge({
        name: 'petapp_chat_connections', help: 'Open chat WebSocket connections on this instance', registers: [metrics.registry],
        collect() {
          let n = 0;
          for (const set of clients.values()) n += set.size;
          this.set(n);
        },
      });
    }
  }

  /** Listens for WebSocket upgrades on the API's HTTP server. Called once at start-up. */
  attach(server: Server): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => void this.upgrade(req, socket, head));
    void this.realtime.subscribe((to, event) => this.deliver(to, event)).then((u) => (this.unsubscribe = u));
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== CHAT_WS_PATH) return reject(404, 'Not Found');
      const userId = await this.realtime.redeemTicket(url.searchParams.get('ticket') ?? '');
      if (!userId) return reject(401, 'Unauthorized');
      const access = await this.rbac.getAccess(userId);
      if (!access || access.status !== 'ACTIVE') return reject(403, 'Forbidden');
      if ((this.clients.get(userId)?.size ?? 0) >= MAX_SOCKETS_PER_USER) return reject(429, 'Too Many Requests');
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.connected(ws, userId));
    } catch (e) {
      this.logger.warn(`chat upgrade failed: ${(e as Error).message}`);
      reject(500, 'Internal Server Error');
    }
  }

  private connected(ws: WebSocket, userId: string) {
    const client: Client = { ws, userId, alive: true, typing: new Map() };
    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(client);
    void this.realtime.markOnline(userId);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data) => void this.command(client, data.toString()));
    ws.on('close', () => {
      set!.delete(client);
      if (!set!.size) {
        this.clients.delete(userId);
        void this.realtime.markOffline(userId);
      }
    });
    ws.on('error', () => ws.terminate());
    this.send(ws, { type: 'hello' });
  }

  private async command(c: Client, raw: string) {
    const cmd = parseClientCommand(raw);
    if (!cmd) return;
    if (cmd.type === 'ping') return this.send(c.ws, { type: 'pong' });
    const now = Date.now();
    let t = c.typing.get(cmd.conversationId);
    if (!t || t.until < now) {
      const targets = await this.chat.typingTargets(c.userId, cmd.conversationId);
      if (!targets) return;
      t = { ...targets, until: now + 60_000, last: 0 };
      if (c.typing.size > 50) c.typing.clear();
      c.typing.set(cmd.conversationId, t);
    }
    if (now - t.last < TYPING_EVERY_MS) return;
    t.last = now;
    this.realtime.publish(t.to, { type: 'typing', conversationId: cmd.conversationId, side: t.side });
  }

  private deliver(userIds: string[], event: ChatEvent) {
    const payload = JSON.stringify(event);
    for (const id of userIds) for (const c of this.clients.get(id) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  }

  /** Drops dead connections, keeps presence fresh, and closes sockets of accounts that were suspended meanwhile. */
  private async beat() {
    for (const [userId, set] of this.clients) {
      const access = await this.rbac.getAccess(userId).catch(() => null);
      for (const c of set) {
        if (!access || access.status !== 'ACTIVE') {
          c.ws.close(4403, 'account not active');
          continue;
        }
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
      if (access?.status === 'ACTIVE') await this.realtime.markOnline(userId).catch(() => undefined);
    }
  }

  private send(ws: WebSocket, v: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(v));
  }

  async onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribe?.();
    for (const set of this.clients.values()) for (const c of set) c.ws.close(1001, 'server restarting');
    this.clients.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }
}
