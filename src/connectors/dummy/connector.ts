import type { Channel, InboundSignal, Principal } from '../../domain';
import type { Connector, Cursor, OutboundMessage } from '../types';

export interface SentLogEntry {
  channel: Channel;
  principal: Principal;
  sentRef: string;
  message: OutboundMessage;
}

/** ダミー上流の保存先（受信キューと送信ログ）。メモリ版と DB 版がある */
export interface DummyBackend {
  enqueue(channel: Channel, signal: InboundSignal): Promise<void>;
  /** principal で取得できる未取得のシグナルを取り出す */
  take(channel: Channel, principal: Principal): Promise<InboundSignal[]>;
  logSent(entry: SentLogEntry): Promise<number>;
}

export interface DummyOptions {
  /** 送ったメッセージを次の pull で observed-sent として返す（H5 用） */
  echoObserved?: boolean;
}

/**
 * ダミーコネクタ。pull はキューから返し、send は送信ログに書くだけ。
 */
export class DummyConnector implements Connector {
  constructor(
    readonly channel: Channel,
    private readonly backend: DummyBackend,
    private readonly options: DummyOptions = {},
  ) {}

  async pull(principal: Principal, _since: Cursor) {
    const signals = await this.backend.take(this.channel, principal);
    return { signals, cursor: null };
  }

  async send(principal: Principal, msg: OutboundMessage) {
    const n = await this.backend.logSent({ channel: this.channel, principal, sentRef: '', message: msg });
    const sentRef = `<dummy-${this.channel}-${n}@murmur.invalid>`;
    if (this.options.echoObserved) {
      await this.backend.enqueue(this.channel, {
        channel: this.channel,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        body: msg.body,
        attachments: msg.attachments,
        anchors: { messageId: sentRef, inReplyTo: msg.inReplyTo },
        sourceRef: `observed:${sentRef}`,
        acquiredAs: principal,
      });
    }
    return { sentRef };
  }
}

export function samePrincipal(a: Principal, b: Principal): boolean {
  return a.kind === 'user' ? b.kind === 'user' && a.userId === b.userId : b.kind === 'organization' && a.tenantId === b.tenantId;
}

export class MemoryDummyBackend implements DummyBackend {
  readonly queue: { channel: Channel; signal: InboundSignal }[] = [];
  readonly sent: SentLogEntry[] = [];

  async enqueue(channel: Channel, signal: InboundSignal) {
    this.queue.push({ channel, signal });
  }

  async take(channel: Channel, principal: Principal) {
    const taken: InboundSignal[] = [];
    for (let i = 0; i < this.queue.length; ) {
      const item = this.queue[i]!;
      if (item.channel === channel && samePrincipal(item.signal.acquiredAs, principal)) {
        taken.push(item.signal);
        this.queue.splice(i, 1);
      } else i++;
    }
    return taken;
  }

  async logSent(entry: SentLogEntry) {
    this.sent.push(entry);
    return this.sent.length;
  }
}
