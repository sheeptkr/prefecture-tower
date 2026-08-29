import { DurableObject } from 'cloudflare:workers';
import prefecturesJson from '../public/assets/prefectures.json';
import hintsJson from '../public/assets/prefecture-hints.json';
import { BATTLE_RECONNECT_GRACE_MS, BATTLE_ROOM_ID_LENGTH, BATTLE_ROOM_TTL_MS } from '../src/constants';
import { resolveAuthoritativeDrop } from '../src/battle/physics';
import { parseClientMessage } from '../src/battle/protocol';
import type { BattleView, PlayerNumber, ServerMessage } from '../src/battle/protocol';
import { BattleStateMachine } from '../src/battle/state';
import type { PrefectureHints, StoredBattle } from '../src/battle/state';
import type { PrefectureAssetCollection } from '../src/types';

const data = prefecturesJson as PrefectureAssetCollection;
const hints = (hintsJson as { records: PrefectureHints[] }).records;
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface Env {
  BATTLE_ROOMS: DurableObjectNamespace<BattleRoom>;
  ALLOWED_ORIGIN?: string;
}

type SocketAttachment = { playerNumber?: PlayerNumber };

function roomId(): string {
  const bytes = new Uint8Array(BATTLE_ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const configuredOrigins = (env.ALLOWED_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const isAllowed = isLocal || configuredOrigins.includes('*') || configuredOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method === 'POST' && url.pathname === '/rooms') {
      return Response.json({ roomId: roomId() }, { headers: corsHeaders(request, env) });
    }
    const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/ws$/);
    if (match && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const id = env.BATTLE_ROOMS.idFromName(match[1]!);
      return env.BATTLE_ROOMS.get(id).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class BattleRoom extends DurableObject<Env> {
  private machine: BattleStateMachine | null = null;
  private initialization: Promise<void>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.initialization = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredBattle>('battle');
      if (stored) this.machine = new BattleStateMachine(stored.roomId, stored.seed, data, hints, stored);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialization;
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const match = new URL(request.url).pathname.match(/^\/rooms\/([A-Z0-9]{6})\/ws$/);
    if (!match) return new Response('Invalid room', { status: 400 });
    if (!this.machine) this.machine = new BattleStateMachine(match[1]!, crypto.getRandomValues(new Uint32Array(1))[0]!, data, hints);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    await this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.initialization;
    const parsed = parseClientMessage(typeof message === 'string' ? message : new TextDecoder().decode(message));
    if (!parsed || !this.machine) {
      this.send(socket, { type: 'error', code: 'invalid_message', message: '無効なメッセージです。' });
      return;
    }
    if (parsed.type === 'ping') {
      this.send(socket, { type: 'pong', serverTime: Date.now() });
      return;
    }
    if (parsed.type === 'join') {
      const token = parsed.reconnectToken ?? crypto.randomUUID();
      const player = this.machine.addPlayer(token, Date.now());
      if (!player) {
        this.send(socket, { type: 'error', code: 'room_full', message: 'この部屋は2人です。' });
        socket.close(4003, 'Room full');
        return;
      }
      socket.serializeAttachment({ playerNumber: player.number } satisfies SocketAttachment);
      for (const other of this.ctx.getWebSockets()) {
        if (other === socket) continue;
        const attachment = other.deserializeAttachment() as SocketAttachment | null;
        if (attachment?.playerNumber === player.number) other.close(4001, 'Reconnected elsewhere');
      }
      this.send(socket, { type: 'joined', reconnectToken: token, state: this.view(player.number) });
      await this.afterMutation();
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const playerNumber = attachment?.playerNumber;
    if (!playerNumber) {
      this.send(socket, { type: 'error', code: 'not_joined', message: '先に部屋へ参加してください。' });
      return;
    }

    const now = Date.now();
    let accepted = true;
    if (parsed.type === 'move') accepted = this.machine.move(playerNumber, parsed.direction, now);
    if (parsed.type === 'rotate') accepted = this.machine.rotate(playerNumber, parsed.direction, now);
    if (parsed.type === 'drop') {
      accepted = this.machine.requestDrop(playerNumber, now);
      if (accepted) this.stageDrop();
    }
    if (parsed.type === 'dropComplete') {
      const state = this.machine.state;
      if (state.phase === 'dropping'
        && parsed.dropSequence === state.dropSequence
        && state.deadline !== null
        && now >= state.deadline) this.completeDrop(now);
    }
    if (parsed.type === 'attackSelect') accepted = this.machine.selectAttack(playerNumber, parsed.cardId, now);
    if (parsed.type === 'rematch') accepted = this.machine.requestRematch(playerNumber, now);
    if (parsed.type === 'leave') this.machine.leave(playerNumber, now);
    if (!accepted) {
      this.send(socket, { type: 'error', code: 'rejected_input', message: '現在の手番・フェーズではその操作はできません。' });
      return;
    }
    await this.afterMutation();
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.initialization;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.playerNumber && this.machine) {
      const stillConnected = this.ctx.getWebSockets().some((candidate) => {
        const other = candidate.deserializeAttachment() as SocketAttachment | null;
        return candidate !== socket && other?.playerNumber === attachment.playerNumber;
      });
      if (!stillConnected) this.machine.disconnect(attachment.playerNumber, Date.now());
      await this.afterMutation();
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    await this.initialization;
    if (!this.machine) return;
    const now = Date.now();
    if (this.machine.state.deadline === null && now >= this.machine.state.updatedAt + BATTLE_ROOM_TTL_MS) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'Room expired');
      await this.ctx.storage.deleteAll();
      this.machine = null;
      return;
    }
    for (const player of this.machine.state.players) {
      if (!player.connected && player.disconnectedAt !== null && now >= player.disconnectedAt + BATTLE_RECONNECT_GRACE_MS) {
        this.machine.leave(player.number, now);
        player.disconnectedAt = null;
        await this.afterMutation();
        return;
      }
    }
    const effect = this.machine.expire(now);
    if (effect === 'drop') this.stageDrop();
    if (effect === 'dropResolved') this.completeDrop(now);
    await this.afterMutation();
  }

  private stageDrop(): void {
    const state = this.machine!.state;
    if (!state.currentPrefectureCode) return;
    const result = resolveAuthoritativeDrop(data, state.seed, state.board, state.currentPrefectureCode, state.placement);
    this.machine!.stageDrop(result.durationMs, Date.now());
  }

  private completeDrop(now: number): void {
    const state = this.machine!.state;
    if (!state.currentPrefectureCode) return;
    const result = resolveAuthoritativeDrop(data, state.seed, state.board, state.currentPrefectureCode, state.placement);
    this.machine!.completeDrop(result.board, result.heightKm, result.gameOver, now);
  }

  private view(playerNumber: PlayerNumber): BattleView {
    const state = this.machine!.state;
    return {
      roomId: state.roomId,
      phase: state.phase,
      players: state.players.map((player) => ({ number: player.number, connected: player.connected })),
      you: playerNumber,
      turn: state.turn,
      currentPrefectureCode: state.currentPrefectureCode,
      nextPrefectureCode: state.nextPrefectureCode,
      placement: { ...state.placement },
      dropSequence: state.dropSequence,
      score: state.score,
      heightKm: state.heightKm,
      deadline: state.deadline,
      board: state.board,
      attackCards: state.attackCards.map(({ id, hints: cardHints, prefectureCode }) => ({
        id,
        hints: cardHints,
        answerPrefectureName: state.phase === 'prefectureAttackReveal'
          ? data.assets.find((asset) => asset.code === prefectureCode)?.nameJa ?? null
          : null,
      })),
      attackPlayer: state.attackPlayer,
      winner: state.winner,
      loser: state.loser,
      rematchReady: state.rematchReady,
      matchNumber: state.matchNumber,
      seed: state.seed,
    };
  }

  private broadcast(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.playerNumber) this.send(socket, { type: 'roomState', state: this.view(attachment.playerNumber) });
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A concurrent close is handled by webSocketClose.
    }
  }

  private async afterMutation(): Promise<void> {
    await this.persist();
    this.broadcast();
    await this.scheduleAlarm();
  }

  private async persist(): Promise<void> {
    if (this.machine) await this.ctx.storage.put('battle', this.machine.state);
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.machine) return;
    const deadlines = [this.machine.state.deadline]
      .concat(this.machine.state.players.map((player) => player.connected || player.disconnectedAt === null ? null : player.disconnectedAt + BATTLE_RECONNECT_GRACE_MS))
      .filter((value): value is number => value !== null);
    const next = deadlines.length > 0 ? Math.min(...deadlines) : this.machine.state.updatedAt + BATTLE_ROOM_TTL_MS;
    await this.ctx.storage.setAlarm(next);
  }
}
