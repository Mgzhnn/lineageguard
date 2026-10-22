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
  /** Disable the built-in lexical families and evaluate custom rules only. */
  includeBuiltInRules?: boolean;
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
  { term: "suggested", rank: 0 },
  // Base forms and their kin: "Early data suggest …" and "Studies prove …"
  // were invisible with only the third-person forms listed (2026-10-22 review).
  { term: "suggest", rank: 0 },
  { term: "seem", rank: 0 },
  { term: "seems", rank: 0 },
  { term: "seemed", rank: 0 },
  { term: "appear", rank: 0 },
  { term: "appeared", rank: 0 },
  { term: "estimated", rank: 0 },
  { term: "approximately", rank: 0 },
  { term: "likely", rank: 1 },
  { term: "probably", rank: 1 },
  { term: "indicates", rank: 1 },
  { term: "indicated", rank: 1 },
  { term: "supports", rank: 1 },
  { term: "expected", rank: 1 },
  { term: "show", rank: 2 },
  { term: "shows", rank: 2 },
  { term: "showed", rank: 2 },
  { term: "shown", rank: 2 },
  { term: "demonstrates", rank: 2 },
  { term: "demonstrated", rank: 2 },
  { term: "will", rank: 2 },
  { term: "confirmed", rank: 3 },
  { term: "prove", rank: 3 },
  { term: "proves", rank: 3 },
  { term: "proved", rank: 3 },
  { term: "proven", rank: 3 },
  { term: "conclusive", rank: 3 },
  { term: "definitive", rank: 3 },
  { term: "guaranteed", rank: 3 },
  { term: "guarantees", rank: 3 },
  { term: "definitely", rank: 3 },
  { term: "certainly", rank: 3 },
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
];

// Any "...n't" contraction counts: normalize() folds curly apostrophes, so
// "hasn't" and "hasn’t" both match, and dropping either is a lost negation.
const negationPattern =
  /\b(?:not|no|none|never|without|cannot|must not|do not|\w+n't)\b/gi;

const completedActionPattern =
  /\b(?:sent|emailed|contacted|published|posted|deleted|purchased|bought|booked|deployed|executed|transferred|submitted|released|shared)\b/gi;

const guardedActionPattern =
  /\b(?:do not|don't|must not|never|draft only|human approval|approval required|before approval|no external action|without approval|do not send|do not contact|do not publish)\b/i;

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
  // NFKC folds full-width letters ("ｃｏｎｆｉｒｍｅｄ"), and format characters
  // such as a zero-width space ("con\u200Bfirmed") are removed, so neither can
  // hide a term (2026-10-22 review).
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/[’‘ʼ＇]/g, "'")
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

function findTermIndexes(text: string, term: string): number[] {
  if (hasNonAsciiLetters(term)) {
    const indexes: number[] = [];
    let from = text.indexOf(term);
    while (from >= 0) {
      indexes.push(from);
      from = text.indexOf(term, from + term.length);
    }
    return indexes;
  }
  return [...text.matchAll(new RegExp(`\\b${escapeRegex(term)}\\b`, "gi"))]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);
}

const sentenceEndPattern = /[.!?;]/g;
const contrastBoundaryGlobal =
  /\b(?:and|but|however|although|yet|nevertheless|whereas|while)\b/gi;
const uncertaintyHedgePattern =
  /\b(?:uncertain|unconfirmed|preliminary|pending|may|might|could|possibly|possible|appear|appears|appeared|suggest|suggests|suggested|seem|seems|seemed|estimated|approximately|likely|probably)\b/gi;

type HedgeIndex = {
  sentenceEnds: number[];
  hedgeStarts: number[];
  hedgeEnds: number[];
  contrasts: number[];
  commas: number[];
};

function buildHedgeIndex(text: string): HedgeIndex {
  const positions = (pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m.index ?? 0);
  const hedges = [...text.matchAll(uncertaintyHedgePattern)];
  return {
    sentenceEnds: positions(sentenceEndPattern),
    hedgeStarts: hedges.map((m) => m.index ?? 0),
    hedgeEnds: hedges.map((m) => (m.index ?? 0) + m[0].length),
    contrasts: positions(contrastBoundaryGlobal),
    commas: positions(/,/g),
  };
}

/** Whether a sorted position list has an element in [from, to). */
function anyIn(sorted: readonly number[], from: number, to: number) {
  const at = lowerBound(sorted, from);
  return at < sorted.length && sorted[at] < to;
}

// Whether a hedge in the strong term's sentence qualifies it: no contrast word
// ("but", "while", ...) between them, and, for a hedge after the term, no comma
// (a trailing comma clause qualifies itself). Positions are found once per text;
// rescanning the sentence for every strong term was quadratic on a long stage
// without full stops: 38 s at 200 KB (2026-10-22 review). Only the nearest hedge
// on each side needs checking, since a farther one has the same contrast word or
// comma between it and the term.
function hasIndexedHedgeInClause(
  index: HedgeIndex,
  textLength: number,
  strongTermIndex: number,
  strongTermLength: number,
) {
  const strongEnd = strongTermIndex + strongTermLength;
  const previousEnd = lowerBound(index.sentenceEnds, strongTermIndex) - 1;
  const clauseStart = previousEnd >= 0 ? index.sentenceEnds[previousEnd] + 1 : 0;
  const nextEnd = lowerBound(index.sentenceEnds, strongEnd);
  const clauseEnd = nextEnd < index.sentenceEnds.length ? index.sentenceEnds[nextEnd] : textLength;

  const before = lowerBound(index.hedgeStarts, strongTermIndex) - 1;
  if (
    before >= 0 &&
    index.hedgeStarts[before] >= clauseStart &&
    !anyIn(index.contrasts, index.hedgeEnds[before], strongTermIndex)
  ) {
    return true;
  }
  const after = lowerBound(index.hedgeStarts, strongEnd);
  if (
    after < index.hedgeStarts.length &&
    index.hedgeEnds[after] <= clauseEnd &&
    !anyIn(index.commas, strongEnd, index.hedgeStarts[after]) &&
    !anyIn(index.contrasts, strongEnd, index.hedgeStarts[after])
  ) {
    return true;
  }
  return false;
}

function findTerms(
  text: string,
  terms: RankedTerm[],
  scopeStrongTermsWithUncertainty = false,
) {
  // Complete dates are blanked first so the month "May" is never read as a
  // hedge; "may 24" without a year is excluded by the digit check below.
  const normalized = normalize(extractDateClaims(text).remaining);
  let hedgeIndex: HedgeIndex | null = null;
  return terms.filter(({ term, rank }) =>
    findTermIndexes(normalized, term).some((matchIndex) => {
      const prefix = normalized.slice(Math.max(0, matchIndex - 24), matchIndex);
      const suffix = normalized.slice(matchIndex + term.length, matchIndex + term.length + 12);
      if (/\b(?:not|no|none|never|\w+n't)\s+(?:(?:been|be|being|yet|fully)\s+){0,2}$/i.test(prefix)) {
        return false;
      }
      if (term === "may" && /^\s*\d/.test(suffix)) return false;
      // "the most important factor" is not a population; "most users",
      // "most of them" and "most people" are.
      if (term === "most" && !/^\s+(?:of\b|people\b|\w+s\b)/.test(suffix)) return false;
      if (
        scopeStrongTermsWithUncertainty &&
        rank >= 2 &&
        hasIndexedHedgeInClause(
          (hedgeIndex ??= buildHedgeIndex(normalized)),
          normalized.length,
          matchIndex,
          term.length,
        )
      ) {
        return false;
      }
      return true;
    }),
  );
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

const measurableNouns =
  "seconds?|minutes?|hours?|days?|weeks?|months?|years?|people|users?|customers?|cases?|degrees?";

// Spelled units that sit after a space ("5 miles") are listed; any other
// letters attached to the digits ("30x", "40ms", "12th", "5°C") are kept as the
// unit by the pattern below. Both used to be cut off, so "30x -> 35x" read as
// 3 -> 3 and "5 miles -> 5 feet" as no number at all (2026-10-22 review).
const numberUnitAlternation =
  "miles?|feet|foot|ft|inches|inch|yards?|mph|kph|°c|°f|gb|mb|kb|tb|ms|am|pm|" +
  "%|percent|percentage points?|milligrams?|kilograms?|grams?|milliliters?|millilitres?|liters?|litres?|kilometers?|kilometres?|centimeters?|centimetres?|millimeters?|millimetres?|meters?|metres?|mg|kg|km|ml|cl|cm|mm|g|l|k|m|b|thousand|million|billion|" +
  measurableNouns;

// The trailing lookahead blocks partial unit matches ("500 gallons" must not
// read as 500g).
// The closing lookahead also refuses a digit, comma-digit or point-digit next:
// with only (?![a-z%]) the engine backtracked "30x" to the number 3.
const numberPattern = new RegExp(
  "(?:[≤≥<>]\\s*)?(?:[+-]?[$€£₩]\\s*|[$€£₩]?[+-]?)(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)" +
    `(?:\\s*(?:${numberUnitAlternation})(?![a-z])|[a-zµμ°]+)?` +
    "(?:\\s*(?:-|–|—|to)\\s*(?:[+-]?[$€£₩]\\s*|[$€£₩]?[+-]?)(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)" +
    `(?:\\s*(?:${numberUnitAlternation})(?![a-z])|[a-zµμ°]+)?)?(?![a-z%\\d]|[.,]\\d)`,
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
  }))?|(${Object.keys(wordNumberUnits).join("|")}))[-\\s]+(percent|${measurableNouns})\\b`,
  "gi",
);

function shiftDecimal(value: string, power = 0): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const digits = whole + fraction;
  const point = whole.length + power;
  const expanded = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, decimals = ""] = expanded.split(".");
  const significantDecimals = decimals.replace(/0+$/, "");
  const result = integer.replace(/^0+(?=\d)/, "") + (significantDecimals ? `.${significantDecimals}` : "");
  return negative && result !== "0" ? `-${result}` : result;
}

function singularizeMeasurableNoun(unit: string): string {
  return unit.replace(
    /\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|users?|customers?|cases?|degrees?)\b/g,
    (word) => word.replace(/s$/, ""),
  );
}

function canonicalizeQuantitySide(side: string): string {
  const parsed = side.match(
    /^([$€£₩]?)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(.*)$/,
  );
  if (!parsed) return side.replace(/\s+/g, "");

  const currency = parsed[1] ?? "";
  const value = parsed[2];
  let decimalPower = 0;
  let unit = (parsed[3] ?? "").trim();

  if (unit === "bn") {
    decimalPower = 9;
    unit = "";
  } else if (unit === "thousand" || unit === "k") {
    decimalPower = 3;
    unit = "";
  } else if (unit === "million" || (unit === "m" && currency)) {
    decimalPower = 6;
    unit = "";
  } else if (unit === "billion" || (unit === "b" && currency)) {
    decimalPower = 9;
    unit = "";
  } else {
    const singular = singularizeMeasurableNoun(unit).replace(/s$/, "");
    const metric = metricUnitFactors[singular];
    if (metric) {
      decimalPower = Math.round(Math.log10(metric.factor));
      unit = metric.base;
    } else {
      unit = singularizeMeasurableNoun(unit);
    }
  }

  return `${currency}${shiftDecimal(value, decimalPower)}${unit}`;
}

function canonicalizeQuantityToken(raw: string): string {
  // A comparator is part of the claim: "up to 40%" is not "40%".
  const bound = /^\s*([≤≥<>])\s*/.exec(raw);
  if (bound) return bound[1] + canonicalizeQuantityToken(raw.slice(bound[0].length));
  const token = normalize(raw)
    // Commas: thousands groups go, a decimal comma ("1,5 mg") becomes a point,
    // and anything left over (a list comma) is dropped. Stripping every comma
    // read "1,5 mg" as 15 mg (2026-10-22 review).
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/,/g, "")
    .replace(/\bpercentage points?\b/g, "pp")
    .replace(/\bpercent\b/g, "%")
    .replace(/\s+to\s+/g, "-")
    .replace(/[–—]/g, "-");
  // Separate the range delimiter from unary signs, then propagate the shared
  // unit/currency before converting both endpoints.
  const range = /^([$€£₩]?[+-]?(?:\d+(?:\.\d+)?|\.\d+))([^\d-]*?)-([$€£₩]?[+-]?(?:\d+(?:\.\d+)?|\.\d+))(.*)$/.exec(token.replace(/\s+/g, ""));
  if (!range) return canonicalizeQuantitySide(token.replace(/^([+-])([$€£₩])/, "$2$1"));
  let left = range[1];
  let right = range[3];
  const leftCurrency = left.match(/^[$€£₩]/)?.[0] ?? "";
  const rightCurrency = right.match(/^[$€£₩]/)?.[0] ?? "";
  if (!leftCurrency) left = rightCurrency + left;
  if (!rightCurrency) right = leftCurrency + right;
  return [canonicalizeQuantitySide(left + (range[2] || range[4])),
    canonicalizeQuantitySide(right + (range[4] || range[2]))].join("-");
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
  const numericText = text.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[−－]/g, "-").replace(/＋/g, "+").replace(/％/g, "%");
  const { dates, remaining: dated } = extractDateClaims(numericText);
  // Rewrites that mean the same number: "between 12% and 18%" is the range
  // 12–18%, and "5,000 dollars" is $5,000. Bounds stay attached to their
  // number, and a capital M/B/K after digits is a multiplier, not metres.
  const remaining = dated
    .replace(/\b(up to|at most|no more than|a maximum of)\s+(?=[$€£₩]?[+-]?\d)/gi, "≤")
    .replace(/\b(at least|no less than|no fewer than|a minimum of)\s+(?=[$€£₩]?[+-]?\d)/gi, "≥")
    .replace(/\b(less than|fewer than|below)\s+(?=[$€£₩]?[+-]?\d)/gi, "<")
    .replace(/\b(more than|greater than|above)\s+(?=[$€£₩]?[+-]?\d)/gi, ">")
    .replace(/(\d)\s?M\b/g, "$1 million")
    .replace(/(\d)\s?B\b/g, "$1 billion")
    .replace(/(\d)\s?K\b/g, "$1 thousand")
    .replace(
      /\bbetween\s+([$€£₩]?[+-]?\d[^\s]*)\s+and\s+(?=[$€£₩]?[+-]?\d)/gi,
      "$1 to ",
    )
    .replace(
      /(\d[\d,]*(?:\.\d+)?(?:\s*(?:k|thousand|million|billion))?)\s+(dollars?|usd|euros?|eur|pounds?|gbp)\b/gi,
      (_match, amount: string, word: string) => {
        const symbol = /^(dollars?|usd)$/i.test(word) ? "$" : /^(euros?|eur)$/i.test(word) ? "€" : "£";
        return `${symbol}${amount}`;
      },
    );
  const digitClaims = [...remaining.matchAll(numberPattern)]
    .map((match) => canonicalizeQuantityToken(match[0]))
    .filter(Boolean);
  const wordClaims = extractWordNumberClaims(remaining);
  return unique([...dates, ...digitClaims, ...wordClaims]);
}

// The word a negation applies to: "not safe" -> safe, "never approved" ->
// approved. Only a negated word the earlier stage stated positively is a
// flipped claim. An action verb is left out: "not sent" reports an action's
// status, which the guardrail check covers, and "ready but not sent" is the
// safe outcome rather than a reversal.
const negationTargetPattern =
  /\b(?:not|no|never|cannot|\w+n't)\s+(?:(?:yet|been|be|being|fully|currently|at all|really|a|an|the|any)\s+){0,2}([a-z][a-z-]+)/gi;

const completedActionWordPattern = new RegExp(
  `^${completedActionPattern.source.replace(/\\b/g, "")}$`,
  "i",
);

function negatedSourceWords(fromText: string, toText: string) {
  const source = normalize(fromText);
  const targets = [...normalize(toText).matchAll(negationTargetPattern)]
    .map((match) => match[1])
    .filter((word) => !completedActionWordPattern.test(word))
    .filter((word) => findTermIndex(source, word) >= 0);
  return unique(targets);
}

function extractNegations(text: string) {
  const normalized = normalize(text);
  return unique(
    [...normalized.matchAll(negationPattern)].map((match) => match[0]),
  );
}

// A completed-action verb is only an authority violation when the clause has
// an agentive subject (the agent reporting on itself) or the verb's object
// names what the guardrail protects. "The customer sent us a complaint" is a
// third party acting; "the draft was shared with the reviewer for approval"
// is a gated internal handoff; "I sent the email" is the violation.
const agentiveSubjectPattern =
  /\b(?:i|we|i've|we've|the agent|the assistant|this agent)\b/i;
// A passive auxiliary just before the verb ("was sent", "has been already
// sent", "was reviewed and published").
const passiveAuxiliaryPattern =
  /\b(?:is|are|was|were|be|been|being|get|gets|got)\b(?:\s+\w+){0,2}\s*$/i;
const clauseBoundaryPattern = /[.!?;]|\b(?:and|but|however)\b/gi;
const sentenceBoundaryPattern = /[.!?;]/g;
// An object that hands the artifact to the gate ("for approval", "pending
// review") is a request for the gate, not a bypass of it.
const gatedObjectPattern =
  /\b(?:for|pending|awaiting|subject to)\s+(?:(?:further|final|human|manager|internal|a|an|the|your|their)\s+){0,2}(?:approval|review|sign-off|signoff|confirmation|verification)\b/i;
// Guardrail words that describe the gate rather than the protected target.
const gateWords = new Set([
  "approval",
  "approve",
  "approved",
  "approves",
  "review",
  "reviewed",
  "human",
  "only",
  "not",
  "never",
  "without",
  "before",
  "until",
]);
const completedActionLemmas: Record<string, string> = {
  sent: "send",
  emailed: "email",
  contacted: "contact",
  published: "publish",
  posted: "post",
  deleted: "delete",
  purchased: "purchase",
  bought: "buy",
  booked: "book",
  deployed: "deploy",
  executed: "execute",
  transferred: "transfer",
  submitted: "submit",
  released: "release",
  shared: "share",
};

type CompletedActionContext = {
  importantWords: string[];
  label: string;
};

// Boundary positions are found once per text and pattern. clauseAround used
// to rescan from the start of the text for every action verb, which made a
// long stage of repeated verbs quadratic: 93 s at 400 KB (2026-10-22 review).
const boundaryCache = new Map<RegExp, { text: string; starts: number[]; ends: number[] }>();

function boundaryPositions(text: string, boundary: RegExp) {
  const cached = boundaryCache.get(boundary);
  if (cached && cached.text === text) return cached;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of text.matchAll(boundary)) {
    starts.push(match.index ?? 0);
    ends.push((match.index ?? 0) + match[0].length);
  }
  const positions = { text, starts, ends };
  boundaryCache.set(boundary, positions);
  return positions;
}

/** Index of the first element >= value in a sorted array (its length if none). */
function lowerBound(sorted: readonly number[], value: number) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function clauseAround(
  text: string,
  index: number,
  length: number,
  boundary: RegExp,
) {
  const { starts, ends } = boundaryPositions(text, boundary);
  // The last boundary that ends at or before the term, and the first that
  // starts at or after its end; a boundary overlapping the term is skipped.
  const before = lowerBound(ends, index + 1) - 1;
  const after = lowerBound(starts, index + length);
  return {
    start: before >= 0 ? ends[before] : 0,
    end: after < starts.length ? starts[after] : text.length,
  };
}

function isAgentiveCompletedAction(
  normalized: string,
  verbIndex: number,
  verb: string,
  context: CompletedActionContext,
) {
  const clause = clauseAround(normalized, verbIndex, verb.length, clauseBoundaryPattern);
  const sentence = clauseAround(normalized, verbIndex, verb.length, sentenceBoundaryPattern);
  const subject = normalized.slice(clause.start, verbIndex).trim();
  const object = normalized.slice(verbIndex + verb.length, clause.end).trim();
  if (gatedObjectPattern.test(object)) return false;

  const label = normalize(context.label);
  const hasAgentSubject = (span: string) =>
    agentiveSubjectPattern.test(span) ||
    (label.length >= 2 && !stopWords.has(label) && findTermIndex(span, label) >= 0);
  if (subject) {
    if (hasAgentSubject(subject)) return true;
  } else {
    // The verb opens its clause: a coordinated verb inherits the sentence
    // subject ("I reviewed it and sent it"), and a bare fragment ("Sent the
    // email.", "Published.") is the agent reporting on itself.
    const sentenceSubject = normalized.slice(sentence.start, verbIndex).trim();
    if (!sentenceSubject || hasAgentSubject(sentenceSubject)) return true;
  }

  const objectWords = importantGuardrailWords(object).filter(
    (word) => !gateWords.has(word),
  );
  if (objectWords.some((word) => context.importantWords.includes(word))) {
    return true;
  }

  // A passive completion whose verb the guardrail itself names ("Do not
  // publish" / "the note was published") is the agent's own action.
  if (passiveAuxiliaryPattern.test(subject || normalized.slice(sentence.start, verbIndex))) {
    const lemma = completedActionLemmas[verb] ?? verb;
    return context.importantWords.some(
      (word) => !gateWords.has(word) && word.startsWith(lemma),
    );
  }
  return false;
}

function extractCompletedActions(
  text: string,
  context?: CompletedActionContext,
) {
  const normalized = normalize(text);
  return unique(
    [...normalized.matchAll(completedActionPattern)]
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
      .filter(
        (match) =>
          !context ||
          isAgentiveCompletedAction(
            normalized,
            match.index ?? 0,
            match[0],
            context,
          ),
      )
      .map((match) => match[0]),
  );
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
      .replace(/[^a-zÀ-ɏ0-9\s'-]/gi, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          !stopWords.has(word) &&
          // Numeric claims have their own equivalence-aware detector. Counting
          // them again as instruction words can make an equivalent range
          // rewrite look like a dropped guardrail.
          !/^\d/.test(word) &&
          (hasNonAsciiLetters(word) ? word.length >= 2 : word.length > 2),
      ),
  );
}

// A dropped qualifier only counts when the next stage is still talking about
// the same claim. A handoff that moves on to other content (a summary of a
// different part, a status note) keeps at least half of nothing, so it does
// not trigger the rule.
// "still requires verification" carries the same qualification as "pending"
// even though no hedge word survives, so it is not a dropped hedge.
const verificationRequirementPattern =
  /\b(?:requires?|needs?|awaits?|awaiting|pending|under|before|without|until|subject to)\s+(?:(?:further|additional|a|an|the|human|independent)\s+){0,2}(?:verification|review|confirmation|validation|approval|testing|audit)\b/i;

function keepsVerificationRequirement(text: string) {
  return verificationRequirementPattern.test(normalize(text));
}

function restatesClaim(fromText: string, toText: string) {
  const words = importantGuardrailWords(fromText);
  if (words.length < 2) return false;
  const toNormalized = normalize(toText);
  const retained = words.filter((word) => findTermIndex(toNormalized, word) >= 0);
  return retained.length / words.length >= 0.5;
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

  if (
    beforeCertainty &&
    // Rank 1 too: "probably caused" -> "caused" drops a hedge as surely as
    // "may have caused" does (2026-10-22 review).
    beforeCertainty.rank <= 1 &&
    !afterCertainty &&
    !keepsVerificationRequirement(to.text) &&
    restatesClaim(from.text, to.text)
  ) {
    issues.push(
      makeIssue(
        "certainty",
        "medium",
        transitionIndex,
        from,
        to,
        "A hedge was dropped",
        `The earlier handoff qualified the claim with “${beforeCertainty.term}”, but the next handoff restates it with no certainty qualifier at all.`,
        [beforeCertainty.term],
        [],
      ),
    );
  }

  const beforeQuantifier = highestRankedTerm(from.text, quantifierTerms);
  const afterQuantifier = highestRankedTerm(to.text, quantifierTerms);
  if (
    beforeQuantifier &&
    beforeQuantifier.rank <= 1 &&
    !afterQuantifier &&
    restatesClaim(from.text, to.text)
  ) {
    issues.push(
      makeIssue(
        "quantifier",
        "medium",
        transitionIndex,
        from,
        to,
        "A limiting quantifier was dropped",
        `The earlier handoff limited the population with “${beforeQuantifier.term}”, but the next handoff restates the claim with no population qualifier.`,
        [beforeQuantifier.term],
        [],
      ),
    );
  }
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
  // The reverse flip: the claim is restated with a negation it did not have
  // ("is safe" -> "is not safe"). Only the disappearance used to be checked
  // (2026-10-22 review).
  const flipped = !beforeNegations.length ? negatedSourceWords(from.text, to.text) : [];
  if (flipped.length && restatesClaim(from.text, to.text)) {
    issues.push(
      makeIssue(
        "negation",
        "high",
        transitionIndex,
        from,
        to,
        "A negation was added",
        `The next handoff restates the claim with ${afterNegations
          .map((term) => `“${term}”`)
          .join(", ")} in front of “${flipped.join("”, “")}”, which the earlier handoff stated without it. The claim may now say the opposite.`,
        [],
        afterNegations,
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
  const expectsBlockedAction = guardedActionPattern.test(normalizedGuardrail);
  const issues: LineageIssue[] = [];
  let dropReported = false;

  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    const current = stages[stageIndex];
    const previous = stages[stageIndex - 1];
    const currentNormalized = normalize(current.text);
    const previousNormalized = normalize(previous.text);
    const completedActions = extractCompletedActions(current.text, {
      importantWords,
      label: current.label,
    });
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
      !dropReported &&
      importantWords.length >= 2 &&
      previousRetention >= 0.3 &&
      retention < 0.3
    ) {
      // Keep looking after a dropped guardrail: a later stage that then
      // completes the protected action is the high finding, and stopping
      // here reported only the medium one (2026-10-22 review).
      dropReported = true;
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
    }
  }

  return issues;
}

// The built-in meaning and authority lexicons cover English. Text mostly in
// another script must never be reported as "clean" in deterministic mode,
// because a clean result there is silence, not safety.
const coveredScriptPattern = /[a-zÀ-ɏ]/i;
const MIN_LETTERS_FOR_COVERAGE_CHECK = 8;
const MIN_COVERED_LETTER_RATIO = 0.3;
// Latin-script text that is not English (German, Spanish, ...) passes the
// script test, so it is also checked for English function words. Words that
// are common in other Latin-script languages too (will, has, no, so, also, as,
// do) are deliberately left out; the ratio is a signal, not a classifier.
const englishFunctionWords = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were",
  "it", "that", "this", "with", "for", "on", "not", "be", "by", "at", "from",
  "but", "if", "than", "then", "there", "these", "those", "they", "we", "you",
  "our", "their", "its", "have", "had", "been", "may", "might", "should",
  "would", "could", "can", "only", "before", "after", "until", "while", "when",
  "where", "which", "who", "into", "over", "about", "any", "each", "some",
  "more", "both", "such", "very", "yet", "just", "now",
]);
const MIN_WORDS_FOR_FUNCTION_WORD_CHECK = 6;
const MIN_ENGLISH_FUNCTION_WORD_RATIO = 0.08;

function outsideCoverage(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS_FOR_COVERAGE_CHECK) return false;
  const covered = letters.filter((letter) =>
    coveredScriptPattern.test(letter),
  ).length;
  if (covered / letters.length < MIN_COVERED_LETTER_RATIO) return true;
  const words = normalize(text).match(/\p{L}[\p{L}']*/gu) ?? [];
  if (words.length < MIN_WORDS_FOR_FUNCTION_WORD_CHECK) return false;
  const functionWords = words.filter((word) =>
    englishFunctionWords.has(word),
  ).length;
  return functionWords / words.length < MIN_ENGLISH_FUNCTION_WORD_RATIO;
}

function analyzeCoverage(stages: TraceStage[], guardrail = ""): LineageIssue[] {
  if (stages.length < 2) return [];
  const uncoveredStageIndexes: number[] = [];
  stages.forEach((stage, index) => {
    if (outsideCoverage(stage.text)) uncoveredStageIndexes.push(index);
  });
  const issues: LineageIssue[] = [];
  // A guardrail in another language is matched by nothing in the English
  // lexicons, so every action check passed silently (2026-10-22 review).
  if (guardrail.trim() && outsideCoverage(guardrail)) {
    issues.push(
      makeIssue(
        "coverage",
        "low",
        0,
        stages[0],
        stages[1],
        "Guardrail language outside detector coverage",
        "The guardrail is mostly written in a language the built-in authority rules do not cover, so a protected action can pass without a finding. Write the guardrail in English, use semantic mode, or add a domain rule.",
        [],
        [],
      ),
    );
  }
  if (!uncoveredStageIndexes.length) return issues;

  const transitionIndex = Math.max(0, uncoveredStageIndexes[0] - 1);
  const labels = uncoveredStageIndexes
    .map((index) => stages[index].label)
    .join(", ");
  return [
    ...issues,
    makeIssue(
      "coverage",
      "low",
      transitionIndex,
      stages[transitionIndex],
      stages[transitionIndex + 1],
      "Language outside detector coverage",
      `The built-in meaning and authority rules currently cover English, but these stages are mostly written in another script or language: ${labels}. Numeric evidence checks still apply, but a quiet deterministic result here is not evidence of safety. Use semantic mode, review the handoffs manually, or add a domain rule.`,
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
  const includeBuiltInRules = options.includeBuiltInRules ?? true;
  const usableStages = stages.map((stage) => ({
    ...stage,
    text: stage.text.trim(),
  }));
  const issues: LineageIssue[] = [];

  for (let index = 0; index < usableStages.length - 1; index += 1) {
    const from = usableStages[index];
    const to = usableStages[index + 1];
    if (!from.text || !to.text) {
      issues.push(
        makeIssue(
          "coverage",
          "high",
          index,
          from,
          to,
          "Stage content is missing",
          !from.text
            ? "The previous stage is empty, so this handoff has no authoritative claim to compare against."
            : "The proposed handoff is empty, so LineageGuard cannot verify that evidence, meaning, or authority survived the transition.",
          [],
          [],
        ),
      );
      continue;
    }
    if (includeBuiltInRules) {
      issues.push(...analyzeTransition(from, to, index));
    }
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

  if (includeBuiltInRules) {
    issues.push(...analyzeGuardrail(guardrail, usableStages));
    issues.push(...analyzeCoverage(usableStages, guardrail));
  }
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
