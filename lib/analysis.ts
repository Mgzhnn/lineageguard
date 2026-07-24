export type IssueType =
  | "number"
  | "certainty"
  | "quantifier"
  | "negation"
  | "guardrail"
  | "coverage"
  | "custom";

export type Severity = "high" | "medium" | "low";
export type IssueFamily = "evidence" | "meaning" | "authority";

export type TraceStage = {
  id: string;
  label: string;
  text: string;
};

export type LineageIssue = {
  id: string;
  type: IssueType;
  family: IssueFamily;
  severity: Severity;
  transitionIndex: number;
  fromLabel: string;
  toLabel: string;
  title: string;
  explanation: string;
  before: string;
  after: string;
};

export type TransitionResult = {
  fromLabel: string;
  toLabel: string;
  issueCount: number;
  severity: Severity | "clean";
};

export type AnalysisResult = {
  issues: LineageIssue[];
  transitions: TransitionResult[];
  firstMutationIndex: number | null;
  contaminatedOutputs: number;
  overallSeverity: Severity | "clean";
};

export type TraceSignalSnapshot = {
  numbers: string[];
  certainty: string | null;
  certaintyRank: number | null;
  scope: string | null;
  scopeRank: number | null;
  negations: string[];
  completedActions: string[];
};

export type CustomRuleFinding = {
  id?: string;
  severity: Severity;
  title: string;
  explanation: string;
  beforeTerms?: string[];
  afterTerms?: string[];
};

export type CustomLineageRuleContext = {
  from: Readonly<TraceStage>;
  to: Readonly<TraceStage>;
  transitionIndex: number;
  guardrail: string;
  beforeSignals: TraceSignalSnapshot;
  afterSignals: TraceSignalSnapshot;
};

export type CustomLineageRule = {
  id: string;
  family: IssueFamily;
  evaluate: (
    context: CustomLineageRuleContext,
  ) => CustomRuleFinding | CustomRuleFinding[] | null;
};

export type AnalysisOptions = {
  rules?: readonly CustomLineageRule[];
};

type RankedTerm = {
  term: string;
  rank: number;
};

const certaintyTerms: RankedTerm[] = [
  { term: "uncertain", rank: 0 },
  { term: "unconfirmed", rank: 0 },
  { term: "preliminary", rank: 0 },
  { term: "pending", rank: 0 },
  { term: "may", rank: 0 },
  { term: "might", rank: 0 },
  { term: "could", rank: 0 },
  { term: "possibly", rank: 0 },
  { term: "possible", rank: 0 },
  { term: "appears", rank: 0 },
  { term: "suggests", rank: 0 },
  { term: "estimated", rank: 0 },
  { term: "approximately", rank: 0 },
  { term: "likely", rank: 1 },
  { term: "indicates", rank: 1 },
  { term: "supports", rank: 1 },
  { term: "expected", rank: 1 },
  { term: "shows", rank: 2 },
  { term: "demonstrates", rank: 2 },
  { term: "will", rank: 2 },
  { term: "confirmed", rank: 3 },
  { term: "proves", rank: 3 },
  { term: "proven", rank: 3 },
  { term: "guarantees", rank: 3 },
  { term: "definitely", rank: 3 },
  { term: "certainly", rank: 3 },
  // Korean terms use fully conjugated stems so a negated form ("확정되지 않")
  // never contains its assertive counterpart ("확정되었").
  { term: "확정되지 않", rank: 0 },
  { term: "확인되지 않", rank: 0 },
  { term: "확실하지 않", rank: 0 },
  { term: "미확정", rank: 0 },
  { term: "불확실", rank: 0 },
  { term: "잠정", rank: 0 },
  { term: "검토 중", rank: 0 },
  { term: "보류", rank: 0 },
  { term: "수 있", rank: 0 },
  { term: "가능성", rank: 0 },
  { term: "추정", rank: 0 },
  { term: "아마", rank: 0 },
  { term: "예상", rank: 1 },
  { term: "전망", rank: 1 },
  { term: "할 것입니다", rank: 2 },
  { term: "될 것입니다", rank: 2 },
  { term: "할 것이다", rank: 2 },
  { term: "될 것이다", rank: 2 },
  { term: "할 예정", rank: 2 },
  { term: "확정되었", rank: 3 },
  { term: "확정됐", rank: 3 },
  { term: "확정입니다", rank: 3 },
  { term: "확실합니다", rank: 3 },
  { term: "확실하다", rank: 3 },
  { term: "확실히", rank: 3 },
  { term: "분명히", rank: 3 },
  { term: "보장합니다", rank: 3 },
  { term: "보장됩니다", rank: 3 },
  { term: "입증되었", rank: 3 },
  { term: "입증됐", rank: 3 },
  { term: "증명되었", rank: 3 },
  { term: "반드시", rank: 3 },
];

const quantifierTerms: RankedTerm[] = [
  { term: "a few", rank: 0 },
  { term: "few", rank: 0 },
  { term: "some", rank: 0 },
  { term: "several", rank: 1 },
  { term: "many", rank: 2 },
  { term: "most", rank: 3 },
  { term: "all", rank: 4 },
  { term: "every", rank: 4 },
  { term: "always", rank: 4 },
  { term: "none", rank: 4 },
  { term: "never", rank: 4 },
  { term: "일부", rank: 0 },
  { term: "몇몇", rank: 0 },
  { term: "여러", rank: 1 },
  { term: "다수", rank: 2 },
  { term: "많은", rank: 2 },
  { term: "대부분", rank: 3 },
  { term: "대다수", rank: 3 },
  { term: "모든", rank: 4 },
  { term: "모두", rank: 4 },
  { term: "전부", rank: 4 },
  { term: "전체", rank: 4 },
  { term: "항상", rank: 4 },
  { term: "아무도", rank: 4 },
];

const negationPattern =
  /\b(?:not|no|never|without|cannot|can't|won't|isn't|aren't|doesn't|don't|didn't|must not|do not)\b/gi;

// Korean negation follows the verb stem, so these are matched as substrings
// rather than \b-bounded words (JS \b does not work around Hangul).
const koreanNegationPattern =
  /(?:지 않|지 마|지 말|안 됩니다|안 된다|안 됨|없습니다|없음|아닙니다|아니다|못했|못합니다|불가능|금지)/g;

const completedActionPattern =
  /\b(?:sent|emailed|contacted|published|posted|deleted|purchased|bought|booked|deployed|executed|transferred|submitted|released|shared)\b/gi;

// Past/completed conjugations only ("전송했") so negated or prospective forms
// ("전송하지 않았", "전송할") never match.
const koreanCompletedActionPattern =
  /(?:전송했|전송됐|전송되었|발송했|발송됐|발송되었|보냈|게시했|게시됐|게시되었|공개했|삭제했|삭제됐|삭제되었|구매했|결제했|예약했|배포했|배포됐|배포되었|실행했|실행됐|실행되었|이체했|송금했|제출했|제출됐|제출되었|공유했|공유됐|공유되었|연락했|발행했|출시했)/g;

const guardedActionPattern =
  /\b(?:do not|don't|must not|never|draft only|human approval|approval required|before approval|no external action|without approval|do not send|do not contact|do not publish)\b/i;

const koreanGuardedActionPattern =
  /(?:하지 마|하지 말|금지|승인 없이|승인 전|승인이 필요|초안만|보내지 마|전송하지 마|게시하지 마|연락하지 마)/;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const severityWeight: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const ISSUE_FAMILY: Record<IssueType, IssueFamily> = {
  number: "evidence",
  certainty: "meaning",
  quantifier: "meaning",
  negation: "meaning",
  guardrail: "authority",
  coverage: "meaning",
  custom: "meaning",
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// JS \b only works between \w and non-\w, so Hangul terms are located by
// substring search while ASCII terms keep word-boundary matching.
function hasNonAsciiLetters(term: string) {
  return /[^\x00-\x7F]/.test(term);
}

function findTermIndex(text: string, term: string): number {
  if (hasNonAsciiLetters(term)) return text.indexOf(term);
  const match = new RegExp(`\\b${escapeRegex(term)}\\b`, "i").exec(text);
  return match ? match.index : -1;
}

function hasUncertaintyHedgeInClause(
  text: string,
  strongTermIndex: number,
  strongTermLength: number,
) {
  const before = text.slice(0, strongTermIndex);
  const clauseStart =
    Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
      before.lastIndexOf(";"),
    ) + 1;
  const after = text.slice(strongTermIndex + strongTermLength);
  const nextBoundary = after.search(/[.!?;]/);
  const clauseEnd =
    nextBoundary === -1
      ? text.length
      : strongTermIndex + strongTermLength + nextBoundary;
  const clause = text.slice(clauseStart, clauseEnd);
  const strongOffset = strongTermIndex - clauseStart;
  const contrastBoundary =
    /\b(?:and|but|however|although|yet|nevertheless|whereas|while)\b|(?:하지만|그러나|그렇지만|반면)/i;
  const hedgePattern =
    /\b(?:uncertain|unconfirmed|preliminary|pending|may|might|could|possibly|possible|appears|suggests|estimated|approximately|likely)\b/gi;
  const koreanHedgePattern =
    /(?:수 있|수 없|가능성|추정|아마|예상|것으로 보|잠정|미확정|검토 중|보류)/g;

  const hedges = [
    ...clause.matchAll(hedgePattern),
    ...clause.matchAll(koreanHedgePattern),
  ];
  for (const hedge of hedges) {
    if (hedge.index === undefined) continue;
    const hedgeStart = hedge.index;
    const hedgeEnd = hedgeStart + hedge[0].length;
    const between =
      hedgeStart < strongOffset
        ? clause.slice(hedgeEnd, strongOffset)
        : clause.slice(strongOffset + strongTermLength, hedgeStart);
    if (!contrastBoundary.test(between)) return true;
  }
  return false;
}

function findTerms(
  text: string,
  terms: RankedTerm[],
  scopeStrongTermsWithUncertainty = false,
) {
  const normalized = normalize(text);
  return terms.filter(({ term, rank }) => {
    const matchIndex = findTermIndex(normalized, term);
    if (matchIndex < 0) return false;
    const prefix = normalized.slice(Math.max(0, matchIndex - 18), matchIndex);
    if (/\b(?:not|no|never)\s+(?:been\s+)?$/i.test(prefix)) return false;
    if (
      scopeStrongTermsWithUncertainty &&
      rank >= 2 &&
      hasUncertaintyHedgeInClause(normalized, matchIndex, term.length)
    ) {
      return false;
    }
    return true;
  });
}

function highestRankedTerm(
  text: string,
  terms: RankedTerm[],
  scopeStrongTermsWithUncertainty = false,
) {
  const found = findTerms(text, terms, scopeStrongTermsWithUncertainty);
  if (!found.length) return null;
  return found.reduce((highest, candidate) =>
    candidate.rank > highest.rank ? candidate : highest,
  );
}

const monthNumbers: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const monthAlternation =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

// Complete dates only: partial dates ("July 24") stay in the plain number
// path because dropping or adding a year is not a provable equivalence.
const isoDatePattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const koreanDatePattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
const writtenDatePatterns = [
  new RegExp(
    `\\b(${monthAlternation})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(\\d{4})\\b`,
    "gi",
  ),
  new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlternation})\\.?(?:,\\s*|\\s+)(\\d{4})\\b`,
    "gi",
  ),
];

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function extractDateClaims(text: string): {
  dates: string[];
  remaining: string;
} {
  const dates: string[] = [];
  let remaining = text;

  const consume = (match: RegExpExecArray, iso: string | null) => {
    if (!iso) return;
    dates.push(iso);
    remaining =
      remaining.slice(0, match.index) +
      " ".repeat(match[0].length) +
      remaining.slice(match.index + match[0].length);
  };

  for (const match of [...remaining.matchAll(isoDatePattern)]) {
    consume(
      match as RegExpExecArray,
      toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
    );
  }
  for (const match of [...remaining.matchAll(koreanDatePattern)]) {
    consume(
      match as RegExpExecArray,
      toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
    );
  }
  for (const match of [...remaining.matchAll(writtenDatePatterns[0])]) {
    consume(
      match as RegExpExecArray,
      toIsoDate(
        Number(match[3]),
        monthNumbers[match[1].toLowerCase()] ?? 0,
        Number(match[2]),
      ),
    );
  }
  for (const match of [...remaining.matchAll(writtenDatePatterns[1])]) {
    consume(
      match as RegExpExecArray,
      toIsoDate(
        Number(match[3]),
        monthNumbers[match[2].toLowerCase()] ?? 0,
        Number(match[1]),
      ),
    );
  }

  return { dates: unique(dates), remaining };
}

// Metric units canonicalize to one base per dimension (g, l, m) so an
// equivalent rewrite such as 500mg -> 0.5g compares equal.
const metricUnitFactors: Record<string, { factor: number; base: string }> = {
  mg: { factor: 1e-3, base: "g" },
  milligram: { factor: 1e-3, base: "g" },
  g: { factor: 1, base: "g" },
  gram: { factor: 1, base: "g" },
  kg: { factor: 1e3, base: "g" },
  kilogram: { factor: 1e3, base: "g" },
  ml: { factor: 1e-3, base: "l" },
  milliliter: { factor: 1e-3, base: "l" },
  millilitre: { factor: 1e-3, base: "l" },
  cl: { factor: 1e-2, base: "l" },
  l: { factor: 1, base: "l" },
  liter: { factor: 1, base: "l" },
  litre: { factor: 1, base: "l" },
  mm: { factor: 1e-3, base: "m" },
  millimeter: { factor: 1e-3, base: "m" },
  millimetre: { factor: 1e-3, base: "m" },
  cm: { factor: 1e-2, base: "m" },
  centimeter: { factor: 1e-2, base: "m" },
  centimetre: { factor: 1e-2, base: "m" },
  meter: { factor: 1, base: "m" },
  metre: { factor: 1, base: "m" },
  km: { factor: 1e3, base: "m" },
  kilometer: { factor: 1e3, base: "m" },
  kilometre: { factor: 1e3, base: "m" },
};

const koreanMagnitudeFactors: Record<string, number> = {
  천: 1e3,
  만: 1e4,
  십만: 1e5,
  백만: 1e6,
  천만: 1e7,
  억: 1e8,
};

const koreanUnitMap: Record<string, string> = {
  명: "people",
  개: "개",
  번: "번",
  개월: "month",
  년: "year",
  시간: "hour",
  분: "minute",
  초: "second",
  일: "day",
  주: "week",
};

const measurableNouns =
  "seconds?|minutes?|hours?|days?|weeks?|months?|years?|people|users?|customers?|cases?|degrees?";

const numberUnitAlternation =
  "%|percent|percentage points?|milligrams?|kilograms?|grams?|milliliters?|millilitres?|liters?|litres?|kilometers?|kilometres?|centimeters?|centimetres?|millimeters?|millimetres?|meters?|metres?|mg|kg|km|ml|cl|cm|mm|g|l|k|m|b|thousand|million|billion|" +
  measurableNouns +
  "|만원|원|명|개월|개|번|년|시간|분|초|일|주";

// The trailing lookahead blocks partial Latin unit matches ("500 gallons"
// must not read as 500g). Hangul is deliberately absent from it: Korean
// particles legitimately attach to a number or unit ("5만원입니다").
const numberPattern = new RegExp(
  "(?:[$€£₩]\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:천만|백만|십만|억|만|천)?" +
    "(?:\\s*(?:-|–|—|to)\\s*(?:[$€£₩]\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:천만|백만|십만|억|만|천)?)?" +
    `(?:\\s*(?:${numberUnitAlternation}))?(?![a-z%])`,
  "gi",
);

const wordNumberUnits: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const wordNumberTens: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

// Word numbers only count next to a measurable noun ("three customers"), so
// idioms such as "one of the reasons" cannot create claims.
const wordNumberPattern = new RegExp(
  `\\b(?:(${Object.keys(wordNumberTens).join("|")})(?:[-\\s](${
    Object.keys(wordNumberUnits).filter((word) => wordNumberUnits[word] >= 1 && wordNumberUnits[word] <= 9).join("|")
  }))?|(${Object.keys(wordNumberUnits).join("|")}))\\s+(percent|${measurableNouns})\\b`,
  "gi",
);

function formatQuantityValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(parseFloat(value.toPrecision(12)));
}

function singularizeMeasurableNoun(unit: string): string {
  return unit.replace(
    /\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|users?|customers?|cases?|degrees?)\b/g,
    (word) => word.replace(/s$/, ""),
  );
}

function canonicalizeQuantitySide(side: string): string {
  const parsed = side.match(
    /^([$€£₩]?)\s*(\d+(?:\.\d+)?)\s*(천만|백만|십만|억|만|천)?\s*(.*)$/,
  );
  if (!parsed) return side.replace(/\s+/g, "");

  let currency = parsed[1] ?? "";
  let value = parseFloat(parsed[2]);
  const koreanMagnitude = parsed[3] ?? "";
  let unit = (parsed[4] ?? "").trim();

  if (koreanMagnitude) {
    value *= koreanMagnitudeFactors[koreanMagnitude] ?? 1;
  }

  if (unit === "원" || unit === "만원") {
    if (unit === "만원") value *= 1e4;
    currency = "₩";
    unit = "";
  } else if (koreanUnitMap[unit]) {
    unit = koreanUnitMap[unit];
  } else if (unit === "thousand" || unit === "k") {
    value *= 1e3;
    unit = "";
  } else if (unit === "million" || (unit === "m" && currency)) {
    value *= 1e6;
    unit = "";
  } else if (unit === "billion" || (unit === "b" && currency)) {
    value *= 1e9;
    unit = "";
  } else {
    const singular = singularizeMeasurableNoun(unit).replace(/s$/, "");
    const metric = metricUnitFactors[singular];
    if (metric) {
      value *= metric.factor;
      unit = metric.base;
    } else {
      unit = singularizeMeasurableNoun(unit);
    }
  }

  return `${currency}${formatQuantityValue(value)}${unit}`;
}

function canonicalizeQuantityToken(raw: string): string {
  const token = normalize(raw)
    .replace(/,/g, "")
    .replace(/\bpercentage points?\b/g, "pp")
    .replace(/\bpercent\b/g, "%")
    .replace(/\s+to\s+/g, "-")
    .replace(/[–—]/g, "-");
  const sides = token
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!sides.length) return "";
  return sides.map(canonicalizeQuantitySide).join("-");
}

function extractWordNumberClaims(text: string): string[] {
  const claims: string[] = [];
  for (const match of text.matchAll(wordNumberPattern)) {
    const tens = match[1] ? wordNumberTens[match[1].toLowerCase()] ?? 0 : 0;
    const tensUnit = match[2]
      ? wordNumberUnits[match[2].toLowerCase()] ?? 0
      : 0;
    const solo = match[3] ? wordNumberUnits[match[3].toLowerCase()] ?? 0 : 0;
    const value = match[1] ? tens + tensUnit : solo;
    // Route through the shared canonicalizer so "three customers" and
    // "3 customers" cannot drift apart.
    claims.push(canonicalizeQuantityToken(`${value} ${match[4]}`));
  }
  return claims;
}

function extractNumberClaims(text: string) {
  const { dates, remaining } = extractDateClaims(text);
  const digitClaims = [...remaining.matchAll(numberPattern)]
    .map((match) => canonicalizeQuantityToken(match[0]))
    .filter(Boolean);
  const wordClaims = extractWordNumberClaims(remaining);
  return unique([...dates, ...digitClaims, ...wordClaims]);
}

function extractNegations(text: string) {
  const normalized = normalize(text);
  return unique(
    [
      ...normalized.matchAll(negationPattern),
      ...normalized.matchAll(koreanNegationPattern),
    ].map((match) => match[0]),
  );
}

function extractCompletedActions(text: string) {
  const normalized = normalize(text);
  const english = [...normalized.matchAll(completedActionPattern)]
    .filter((match) => {
      const prefix = normalized.slice(
        Math.max(0, (match.index ?? 0) - 80),
        match.index,
      );
      const negations = [...prefix.matchAll(negationPattern)];
      const lastNegation = negations.at(-1);
      if (!lastNegation || lastNegation.index === undefined) return true;
      const between = prefix.slice(
        lastNegation.index + lastNegation[0].length,
      );
      if (/[.!?;,:]|\b(?:and|but|however)\b/i.test(between)) return true;
      const interveningWords = between.trim().split(/\s+/).filter(Boolean);
      return interveningWords.length > 3;
    })
    .map((match) => match[0]);
  // Korean completed forms are past-tense conjugations; the negated form
  // ("전송하지 않았") does not contain them, so no prefix check is needed.
  const korean = [...normalized.matchAll(koreanCompletedActionPattern)].map(
    (match) => match[0],
  );
  return unique([...english, ...korean]);
}

export function getTraceSignalSnapshot(text: string): TraceSignalSnapshot {
  const certainty = highestRankedTerm(text, certaintyTerms, true);
  const scope = highestRankedTerm(text, quantifierTerms);
  const completedActions = extractCompletedActions(text);

  return {
    numbers: extractNumberClaims(text),
    certainty: certainty?.term ?? null,
    certaintyRank: certainty?.rank ?? null,
    scope: scope?.term ?? null,
    scopeRank: scope?.rank ?? null,
    negations: extractNegations(text),
    completedActions,
  };
}

function importantGuardrailWords(text: string) {
  return unique(
    normalize(text)
      .replace(/[^a-z0-9가-힣\s'-]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          !stopWords.has(word) &&
          (hasNonAsciiLetters(word) ? word.length >= 2 : word.length > 2),
      ),
  );
}

function excerpt(text: string, terms: string[]) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "—";
  const lower = compact.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) {
    return compact.length > 150 ? `${compact.slice(0, 147)}…` : compact;
  }

  const start = Math.max(0, index - 54);
  const end = Math.min(compact.length, index + 96);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}

function makeIssue(
  type: IssueType,
  severity: Severity,
  transitionIndex: number,
  from: TraceStage,
  to: TraceStage,
  title: string,
  explanation: string,
  beforeTerms: string[],
  afterTerms: string[],
): LineageIssue {
  return {
    id: `${transitionIndex}-${type}-${title}`,
    type,
    family: ISSUE_FAMILY[type],
    severity,
    transitionIndex,
    fromLabel: from.label,
    toLabel: to.label,
    title,
    explanation,
    before: excerpt(from.text, beforeTerms),
    after: excerpt(to.text, afterTerms),
  };
}

function analyzeCustomRules(
  from: TraceStage,
  to: TraceStage,
  transitionIndex: number,
  guardrail: string,
  rules: readonly CustomLineageRule[],
) {
  const issues: LineageIssue[] = [];
  const context: CustomLineageRuleContext = {
    from,
    to,
    transitionIndex,
    guardrail,
    beforeSignals: getTraceSignalSnapshot(from.text),
    afterSignals: getTraceSignalSnapshot(to.text),
  };

  for (const rule of rules) {
    const ruleId = rule.id.trim();
    const evaluated = rule.evaluate(context);
    const findings = evaluated
      ? Array.isArray(evaluated)
        ? evaluated
        : [evaluated]
      : [];
    findings.forEach((finding, findingIndex) => {
      if (
        !finding ||
        typeof finding !== "object" ||
        (finding.severity !== "low" &&
          finding.severity !== "medium" &&
          finding.severity !== "high") ||
        typeof finding.title !== "string" ||
        typeof finding.explanation !== "string" ||
        (finding.id !== undefined && typeof finding.id !== "string") ||
        (finding.beforeTerms !== undefined &&
          (!Array.isArray(finding.beforeTerms) ||
            finding.beforeTerms.some((term) => typeof term !== "string"))) ||
        (finding.afterTerms !== undefined &&
          (!Array.isArray(finding.afterTerms) ||
            finding.afterTerms.some((term) => typeof term !== "string")))
      ) {
        throw new Error(
          `Custom lineage rule "${ruleId}" returned an invalid finding.`,
        );
      }
      const title = finding.title.trim();
      const explanation = finding.explanation.trim();
      if (!title || !explanation) {
        throw new Error(
          `Custom lineage rule "${ruleId}" returned an incomplete finding.`,
        );
      }
      issues.push({
        ...makeIssue(
          "custom",
          finding.severity,
          transitionIndex,
          from,
          to,
          title,
          explanation,
          finding.beforeTerms ?? [],
          finding.afterTerms ?? [],
        ),
        id: `${transitionIndex}-custom-${ruleId}-${
          finding.id?.trim() || findingIndex + 1
        }`,
        family: rule.family,
      });
    });
  }

  return issues;
}

function validateCustomRules(
  rules: readonly CustomLineageRule[] | undefined,
) {
  if (rules === undefined) return [] as readonly CustomLineageRule[];
  if (!Array.isArray(rules)) {
    throw new Error("Custom lineage rules must be an array.");
  }
  const ids = new Set<string>();
  rules.forEach((rule) => {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof rule.id !== "string" ||
      !rule.id.trim() ||
      (rule.family !== "evidence" &&
        rule.family !== "meaning" &&
        rule.family !== "authority") ||
      typeof rule.evaluate !== "function"
    ) {
      throw new Error(
        "Each custom lineage rule needs an id, family, and synchronous evaluator.",
      );
    }
    const id = rule.id.trim();
    if (ids.has(id)) {
      throw new Error(`Custom lineage rule id "${id}" is duplicated.`);
    }
    ids.add(id);
  });
  return rules;
}

function analyzeTransition(
  from: TraceStage,
  to: TraceStage,
  transitionIndex: number,
): LineageIssue[] {
  const issues: LineageIssue[] = [];
  const beforeNumbers = extractNumberClaims(from.text);
  const afterNumbers = extractNumberClaims(to.text);
  const removedNumbers = beforeNumbers.filter(
    (value) => !afterNumbers.includes(value),
  );
  const addedNumbers = afterNumbers.filter(
    (value) => !beforeNumbers.includes(value),
  );

  if (removedNumbers.length || addedNumbers.length) {
    issues.push(
      makeIssue(
        "number",
        "high",
        transitionIndex,
        from,
        to,
        "Numeric claim changed",
        `The numeric evidence changed from ${
          beforeNumbers.join(", ") || "no number"
        } to ${afterNumbers.join(", ") || "no number"}. Check ranges, units, and rounding.`,
        removedNumbers.length ? removedNumbers : beforeNumbers,
        addedNumbers.length ? addedNumbers : afterNumbers,
      ),
    );
  }

  const beforeCertainty = highestRankedTerm(from.text, certaintyTerms, true);
  const afterCertainty = highestRankedTerm(to.text, certaintyTerms, true);
  if (
    afterCertainty &&
    ((beforeCertainty && afterCertainty.rank > beforeCertainty.rank) ||
      (!beforeCertainty && afterCertainty.rank >= 2))
  ) {
    issues.push(
      makeIssue(
        "certainty",
        afterCertainty.rank === 3 ? "high" : "medium",
        transitionIndex,
        from,
        to,
        "Confidence was inflated",
        beforeCertainty
          ? `Language moved from “${beforeCertainty.term}” to “${afterCertainty.term}”, making the claim sound more certain than the previous handoff.`
          : `The handoff introduced “${afterCertainty.term}” without an explicit certainty qualifier in the previous stage.`,
        beforeCertainty ? [beforeCertainty.term] : [],
        [afterCertainty.term],
      ),
    );
  }

  const beforeQuantifier = highestRankedTerm(from.text, quantifierTerms);
  const afterQuantifier = highestRankedTerm(to.text, quantifierTerms);
  if (
    afterQuantifier &&
    ((beforeQuantifier && afterQuantifier.rank > beforeQuantifier.rank) ||
      (!beforeQuantifier && afterQuantifier.rank >= 3))
  ) {
    issues.push(
      makeIssue(
        "quantifier",
        afterQuantifier.rank === 4 ? "high" : "medium",
        transitionIndex,
        from,
        to,
        "Scope became broader",
        beforeQuantifier
          ? `The population changed from “${beforeQuantifier.term}” to “${afterQuantifier.term}”. A limited claim may now read like a universal one.`
          : `The handoff introduced the broad quantifier “${afterQuantifier.term}” without an explicit population qualifier in the previous stage.`,
        beforeQuantifier ? [beforeQuantifier.term] : [],
        [afterQuantifier.term],
      ),
    );
  }

  const beforeNegations = extractNegations(from.text);
  const afterNegations = extractNegations(to.text);
  if (beforeNegations.length && !afterNegations.length) {
    issues.push(
      makeIssue(
        "negation",
        "high",
        transitionIndex,
        from,
        to,
        "A negative condition disappeared",
        `The earlier handoff contained ${beforeNegations
          .map((term) => `“${term}”`)
          .join(", ")}, but the next handoff contains no explicit negation.`,
        beforeNegations,
        [],
      ),
    );
  }

  return issues;
}

function analyzeGuardrail(
  guardrail: string,
  stages: TraceStage[],
): LineageIssue[] {
  const normalizedGuardrail = normalize(guardrail);
  if (!normalizedGuardrail || stages.length < 2) return [];

  const importantWords = importantGuardrailWords(guardrail);
  const expectsBlockedAction =
    guardedActionPattern.test(normalizedGuardrail) ||
    koreanGuardedActionPattern.test(normalizedGuardrail);
  const issues: LineageIssue[] = [];

  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    const current = stages[stageIndex];
    const previous = stages[stageIndex - 1];
    const currentNormalized = normalize(current.text);
    const previousNormalized = normalize(previous.text);
    const completedActions = extractCompletedActions(current.text);
    const retainedWords = importantWords.filter(
      (word) => findTermIndex(currentNormalized, word) >= 0,
    );
    const retention =
      importantWords.length > 0 ? retainedWords.length / importantWords.length : 1;
    const previousRetainedWords = importantWords.filter(
      (word) => findTermIndex(previousNormalized, word) >= 0,
    );
    const previousRetention =
      importantWords.length > 0
        ? previousRetainedWords.length / importantWords.length
        : 1;

    if (expectsBlockedAction && completedActions.length) {
      issues.push(
        makeIssue(
          "guardrail",
          "high",
          stageIndex - 1,
          previous,
          current,
          "Protected action appears completed",
          `The guardrail blocks or delays an external action, but this handoff says “${completedActions[0]}”. Human review is required.`,
          importantWords,
          completedActions,
        ),
      );
      break;
    }

    if (
      importantWords.length >= 2 &&
      previousRetention >= 0.3 &&
      retention < 0.3
    ) {
      issues.push(
        makeIssue(
          "guardrail",
          "medium",
          stageIndex - 1,
          previous,
          current,
          "Guardrail was not carried forward",
          `Only ${Math.round(
            retention * 100,
          )}% of the important restriction words survived this handoff.`,
          importantWords,
          retainedWords,
        ),
      );
      break;
    }
  }

  return issues;
}

// The meaning and authority lexicons cover English and Korean. A text written
// mostly in another script must never be reported as "clean", because a clean
// result there is silence, not safety.
const coveredScriptPattern = /[a-zÀ-ɏ가-힣]/i;
const MIN_LETTERS_FOR_COVERAGE_CHECK = 20;
const MIN_COVERED_LETTER_RATIO = 0.3;

function analyzeCoverage(stages: TraceStage[]): LineageIssue[] {
  if (stages.length < 2) return [];
  const uncoveredStageIndexes: number[] = [];
  stages.forEach((stage, index) => {
    const letters = stage.text.match(/\p{L}/gu) ?? [];
    if (letters.length < MIN_LETTERS_FOR_COVERAGE_CHECK) return;
    const covered = letters.filter((letter) =>
      coveredScriptPattern.test(letter),
    ).length;
    if (covered / letters.length < MIN_COVERED_LETTER_RATIO) {
      uncoveredStageIndexes.push(index);
    }
  });
  if (!uncoveredStageIndexes.length) return [];

  const transitionIndex = Math.max(0, uncoveredStageIndexes[0] - 1);
  const labels = uncoveredStageIndexes
    .map((index) => stages[index].label)
    .join(", ");
  return [
    makeIssue(
      "coverage",
      "low",
      transitionIndex,
      stages[transitionIndex],
      stages[transitionIndex + 1],
      "Language outside detector coverage",
      `The meaning and authority rule families currently cover English and Korean, but these stages are mostly written in another script: ${labels}. Numeric evidence checks still apply, but a quiet result here is not evidence of safety. Review the handoffs manually or add a domain lexicon.`,
      [],
      [],
    ),
  ];
}

function highestSeverity(
  issues: LineageIssue[],
): Severity | "clean" {
  return issues.reduce<Severity | "clean">(
    (highest, issue) =>
      severityWeight[issue.severity] > severityWeight[highest]
        ? issue.severity
        : highest,
    "clean",
  );
}

export function analyzeLineage(
  stages: TraceStage[],
  guardrail = "",
  options: AnalysisOptions = {},
): AnalysisResult {
  const rules = validateCustomRules(options.rules);
  const usableStages = stages.map((stage) => ({
    ...stage,
    text: stage.text.trim(),
  }));
  const issues: LineageIssue[] = [];

  for (let index = 0; index < usableStages.length - 1; index += 1) {
    const from = usableStages[index];
    const to = usableStages[index + 1];
    if (!from.text || !to.text) continue;
    issues.push(...analyzeTransition(from, to, index));
    issues.push(
      ...analyzeCustomRules(
        from,
        to,
        index,
        guardrail,
        rules,
      ),
    );
  }

  issues.push(...analyzeGuardrail(guardrail, usableStages));
  issues.push(...analyzeCoverage(usableStages));
  issues.sort(
    (a, b) =>
      a.transitionIndex - b.transitionIndex ||
      severityWeight[b.severity] - severityWeight[a.severity],
  );

  const firstMutationIndex = issues.length ? issues[0].transitionIndex : null;
  const transitions = usableStages.slice(0, -1).map((stage, index) => {
    const transitionIssues = issues.filter(
      (issue) => issue.transitionIndex === index,
    );
    return {
      fromLabel: stage.label,
      toLabel: usableStages[index + 1].label,
      issueCount: transitionIssues.length,
      severity: highestSeverity(transitionIssues),
    };
  });

  return {
    issues,
    transitions,
    firstMutationIndex,
    contaminatedOutputs:
      firstMutationIndex === null
        ? 0
        : Math.max(0, usableStages.length - firstMutationIndex - 1),
    overallSeverity: highestSeverity(issues),
  };
}

export function buildPlainTextReport(
  result: AnalysisResult,
  stages: TraceStage[],
) {
  const first =
    result.firstMutationIndex === null
      ? "No mutation detected"
      : `${stages[result.firstMutationIndex].label} → ${
          stages[result.firstMutationIndex + 1].label
        }`;
  const issueLines = result.issues.length
    ? result.issues.map(
        (issue, index) =>
          `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title} — ${
            issue.fromLabel
          } → ${issue.toLabel}\n   ${issue.explanation}`,
      )
    : ["No structured claim mutations were detected."];

  return [
    "LINEAGEGUARD REPORT",
    `First mutation: ${first}`,
    `Outputs after first mutation: ${result.contaminatedOutputs}`,
    "",
    ...issueLines,
    "",
    "Note: heuristic warning only; verify important decisions with the source.",
  ].join("\n");
}
