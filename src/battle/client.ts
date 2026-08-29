import type { BattleView, ClientMessage, CreateRoomResponse, ServerMessage } from './protocol';

type BattleClientEvents = {
  state: (state: BattleView) => void;
  status: (status: 'connecting' | 'connected' | 'reconnecting' | 'closed') => void;
  error: (message: string) => void;
};

export class BattleClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;
  private reconnectAttempts = 0;

  constructor(private readonly apiBase: string, private readonly roomId: string, private readonly events: BattleClientEvents) {}

  static async createRoom(apiBase: string): Promise<CreateRoomResponse> {
    const response = await fetch(`${apiBase}/rooms`, { method: 'POST' });
    if (!response.ok) throw new Error(`部屋を作成できませんでした (${response.status})`);
    return response.json() as Promise<CreateRoomResponse>;
  }

  connect(): void {
    this.explicitlyClosed = false;
    this.events.status(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    const url = new URL(`${this.apiBase}/rooms/${this.roomId}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.events.status('connected');
      // Reconnect identity belongs to this tab. localStorage is shared by every
      // tab in the same browser, which makes an invite opened in a second tab
      // reconnect as player 1 instead of joining as player 2.
      const token = sessionStorage.getItem(this.tokenKey()) ?? undefined;
      this.send({ type: 'join', reconnectToken: token });
    });
    socket.addEventListener('message', (event) => this.receive(String(event.data)));
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.explicitlyClosed) {
        this.events.status('closed');
        return;
      }
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => this.events.error('通信が一時的に不安定です。再接続します。'));
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(leave = false): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (leave) this.send({ type: 'leave' });
    this.socket?.close(1000, 'Leaving');
  }

  private receive(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === 'joined') {
      sessionStorage.setItem(this.tokenKey(), message.reconnectToken);
      this.events.state(message.state);
    } else if (message.type === 'roomState') {
      this.events.state(message.state);
    } else if (message.type === 'error') {
      this.events.error(message.message);
    }
  }

  private scheduleReconnect(): void {
    this.events.status('reconnecting');
    const delay = Math.min(5_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private tokenKey(): string {
    return `prefecture-tower:battle-token:${this.roomId}`;
  }
}
