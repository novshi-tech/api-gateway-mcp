import { MurmurService } from '../../src/app/service';
import { counterIds, ManualClock } from '../../scripts/lib/clock';
export { counterIds, ManualClock };
import { DummyConnector, MemoryDummyBackend } from '../../src/connectors/dummy/connector';
import type { Connectors } from '../../src/connectors/types';
import type { AiDecision, DecisionRequest, Seed } from '../../src/domain';
import type { Decider, ReplyEstimator } from '../../src/ingest/deciders';
import { memoryRepo } from '../../src/store/memory';
import type { Repo } from '../../src/store/types';

/** 依頼を記録し、関数で答える Decider */
export class StubDecider implements Decider {
  readonly requests: DecisionRequest[] = [];
  constructor(private readonly answer: (req: DecisionRequest) => AiDecision) {}
  async decide(req: DecisionRequest) {
    this.requests.push(req);
    return { raw: this.answer(req), by: 'ai' as const };
  }
}

export async function makeService(
  seed: Seed,
  opts: {
    repo?: Repo;
    decide?: (req: DecisionRequest) => AiDecision;
    estimator?: ReplyEstimator;
    echoObserved?: boolean;
    clock?: ManualClock;
  } = {},
) {
  const repo = opts.repo ?? memoryRepo();
  await repo.master.replaceSeed(seed);
  const backend = new MemoryDummyBackend();
  const connectors: Connectors = {
    email: new DummyConnector('email', backend, { echoObserved: opts.echoObserved }),
    slack: new DummyConnector('slack', backend, { echoObserved: opts.echoObserved }),
    line: new DummyConnector('line', backend, { echoObserved: opts.echoObserved }),
  };
  const clock = opts.clock ?? new ManualClock();
  const decider = new StubDecider(
    opts.decide ??
      (() => {
        throw new Error('unexpected AI decision');
      }),
  );
  const service = new MurmurService({
    repo,
    clock,
    newId: counterIds(),
    decider,
    estimator: opts.estimator ?? { estimate: async () => ({ replyExpectedBy: null, by: 'none' }) },
    connectors,
    policy: { ignoreThreshold: 0.8 },
    summarizer: { summarize: async (_p, _t, target, instruction) => `[${target.name}向け要約] ${instruction}` },
  });
  return { service, repo, backend, clock, decider };
}
