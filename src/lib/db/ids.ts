import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  usage: "use",
  mediaAsset: "med",
  learning: "lrn",
  service: "svc",
  staffMember: "stf",
  staffService: "ss",
  appointment: "apt",
  offeredSlot: "ofs",
  webhookEvent: "whev",
  agentJob: "job",
  rateLimitHit: "rl",
  product: "prod",
  productOptionGroup: "pog",
  productOption: "popt",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
