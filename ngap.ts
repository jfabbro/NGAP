export enum ActType {
  // Acts subject to rule 11B
  AMI,
  AMX,
  AIS,
  AMP,
  AMO,
  AMY,
  BSA,
  BSB,
  BSC,
  K,
  KMB,
  SF,
  SP,
  SFI,
  TLS,
  TLL,
  TLD,
  // Supplements and allowances (outside 11B — always 100%)
  DI,
  MAU,
  MCI,
  MIE,
  TMI,
  MN,  // night majoration
  MF,  // Sunday / public-holiday majoration
  IFD, // travel indemnity (forfait de déplacement)
}

// Cumul / billing flags carried by an act — mirror of `flags_cumul` in NGAP.json.
export type CapPeriod = 'day' | 'month' | 'year' | 'episode' | 'session';

// A protected pair = up to 2 acts billed on their own 100% / 50% scale, shielded
// from the general 11B abatement (e.g. a bilateral dressing).
export type ProtectedPair = 'mammary' | 'varices';

export type ActFlags = {
  article11BApplicable: boolean;   // false => the act escapes the 11B abatement (full rate)
  protectedPair: ProtectedPair | null; // act belongs to a protected 2-act pair
  cumulForbidden: boolean;         // cannot be cumulated with any other act of the session
  mutuallyExclusive: boolean;      // among acts of the same family, only the highest is billable
  nonCumulableWith: string[];      // ids of acts this one cannot be cumulated with
  excludesMci: boolean;            // presence of this act forbids billing the MCI allowance
  capMax: number | null;           // max billable occurrences over `capPeriod`
  capPeriod: CapPeriod | null;
  absorbsTypes: ActType[];         // allowance/majoration types this forfait suppresses
  excludesFirstOccurrence: boolean; // first occurrence is not billable (e.g. physician's)
  prescriptionRequired: boolean;   // act needs a valid prescription to be billable
  priorAgreementRequired: boolean; // "accord préalable" gating reimbursement
};

export type Act = {
  id: string;
  name: string;
  keywords: string[];
  type: ActType;
  coefficient: number;
  family?: string;                 // id_famille_parente from NGAP.json
  flags?: Partial<ActFlags>;
};

// Past billing of the patient, used to enforce caps (category 4). `occurrences`
// counts how many times an act id was already billed within its cap period.
export type BillingHistory = {
  occurrences: Record<string, number>;
};

// Prescription covering the session, used for prescription derogations (category 5).
export type Prescription = {
  date: string;          // ISO date the prescription was written
  untilHealing: boolean; // "jusqu'à cicatrisation" — covers dressings up to 3 months
  coveredActIds: string[]; // act ids explicitly covered by the prescription
};

export type PatientContext = {
  dependent: boolean;
  childUnder5: boolean;
  today?: string;            // ISO date of the session (defaults to now)
  history?: BillingHistory;
  prescription?: Prescription;
  priorAgreements?: string[]; // act ids for which prior agreement (AP) was granted
};

// Intermediate state flowing through the exception pipeline.
export type Proposition = {
  act: Act;
  rate: number;
};

export type ActResult = {
  id: string;
  type: ActType;
  coefficient: number;
  rate: number;
  amount: number;
};

// ─── Letter values ────────────────────────────────────────────────────────────

const LETTER_VALUE: Record<ActType, number> = {
  [ActType.AMI]: 3.15,
  [ActType.AMX]: 3.15,
  [ActType.AIS]: 2.65,
  [ActType.AMP]: 0,    // TODO exact value
  [ActType.AMO]: 0,    // TODO exact value
  [ActType.AMY]: 0,    // TODO exact value
  [ActType.BSA]: 3.15, // BSI flat rate — to refine
  [ActType.BSB]: 3.15,
  [ActType.BSC]: 3.15,
  [ActType.K]:   0,    // TODO exact value
  [ActType.KMB]: 0,    // TODO exact value
  [ActType.SF]:  0,    // TODO exact value
  [ActType.SP]:  0,    // TODO exact value
  [ActType.SFI]: 0,    // TODO exact value
  [ActType.TLS]: 0.35, // TODO confirm exact value
  [ActType.TLL]: 0.50, // TODO confirm exact value
  [ActType.TLD]: 0.65, // TODO confirm exact value
  [ActType.DI]:  2.75,
  [ActType.MAU]: 1.35,
  [ActType.MCI]: 3.15,
  [ActType.MIE]: 3.15,
  [ActType.TMI]: 3.15, // TODO confirm exact value
  [ActType.MN]:  0,    // TODO exact value (night majoration)
  [ActType.MF]:  0,    // TODO exact value (Sunday / public-holiday majoration)
  [ActType.IFD]: 2.75, // travel indemnity — config 2026
};

// ─── Default propositions ─────────────────────────────────────────────────────

// Base: all acts start at rate 1. Exceptions are applied on top.
const buildDefaultPropositions = (acts: Act[]): Proposition[] => (
  acts.map((act) => ({ act, rate: 1 }))
);

// ─── Exceptions ───────────────────────────────────────────────────────────────

// Every exception reads the current propositions and returns the adjusted ones.
// Chaining them in order defines their priority.
export type ExceptionFn = (propositions: Proposition[], ctx: PatientContext) => Proposition[];

const RANK_RATES = [1, 0.5, 0];

const DEFAULT_FLAGS: ActFlags = {
  article11BApplicable: true,
  protectedPair: null,
  cumulForbidden: false,
  mutuallyExclusive: false,
  nonCumulableWith: [],
  excludesMci: false,
  capMax: null,
  capPeriod: null,
  absorbsTypes: [],
  excludesFirstOccurrence: false,
  prescriptionRequired: false,
  priorAgreementRequired: false,
};

const flagsOf = (act: Act): ActFlags => ({ ...DEFAULT_FLAGS, ...act.flags });

// ── Article 11B abatement (rank-based rate) ──────────────────────────────────

// Acts subject to 11B are ranked by coefficient: 1st at 100%, 2nd at 50%, rest 0.
// Acts flagged `article11BApplicable: false` escape the abatement entirely and
// keep their full rate without consuming a rank slot (covers category 1).
const exception11B: ExceptionFn = (propositions) => {
  const ACTS_11B = new Set([ActType.AMI, ActType.AMX]);
  const isSubject = (p: Proposition): boolean => {
    const flags = flagsOf(p.act);
    return (ACTS_11B.has(p.act.type) && flags.article11BApplicable && flags.protectedPair === null);
  };

  const rateById = new Map(
    propositions
      .filter(isSubject)
      .sort((a, b) => b.act.coefficient - a.act.coefficient)
      .map((p, i) => [p.act.id, RANK_RATES[i] ?? 0]),
  );

  return (
    propositions.map((p) => {
      if (!isSubject(p)) {
        return (p);
      }
      return ({ ...p, rate: rateById.get(p.act.id) ?? 0 });
    })
  );
};

const exceptionBSI: ExceptionFn = (propositions, ctx) => {
  if (!ctx.dependent) {
    return (propositions);
  }
  return (
    propositions.map((p) => ({
      act: { ...p.act, type: p.act.type === ActType.AMI ? ActType.AMX : p.act.type },
      rate: 0.5,
    }))
  );
};

// ── Category 3 — non-cumulable acts ──────────────────────────────────────────

// (3c–3f) An act flagged `cumulForbidden`, or listing a present act in
// `nonCumulableWith`, drops to rate 0. Each clinical pair is encoded through the
// flags the acts carry in NGAP.json (e.g. self-catheterization education lists the
// urethral catheterization id; the infusion-removal forfait lists the
// continuous-surveillance forfait id).
const exceptionNonCumulable: ExceptionFn = (propositions) => {
  const presentIds = new Set(propositions.map((p) => p.act.id));
  const hasOthers = propositions.length > 1;

  return (
    propositions.map((p) => {
      const flags = flagsOf(p.act);
      const conflicts = flags.nonCumulableWith.some((id) => presentIds.has(id));
      if (conflicts || (flags.cumulForbidden && hasOthers)) {
        return ({ ...p, rate: 0 });
      }
      return (p);
    })
  );
};

// (3a, 3b) Acts flagged `mutuallyExclusive` are not cumulable with one another
// within the same family (e.g. the article-10 surveillance acts): only the
// highest-coefficient one is billed, the others drop to 0.
const exceptionFamilyMutualExclusion: ExceptionFn = (propositions) => {
  const winnerByFamily = new Map<string, string>();
  propositions
    .filter((p) => p.act.family !== undefined && flagsOf(p.act).mutuallyExclusive)
    .sort((a, b) => b.act.coefficient - a.act.coefficient)
    .forEach((p) => {
      if (!winnerByFamily.has(p.act.family as string)) {
        winnerByFamily.set(p.act.family as string, p.act.id);
      }
    });

  return (
    propositions.map((p) => {
      if (!flagsOf(p.act).mutuallyExclusive || p.act.family === undefined) {
        return (p);
      }
      const isWinner = winnerByFamily.get(p.act.family) === p.act.id;
      return (isWinner ? p : { ...p, rate: 0 });
    })
  );
};

// (3g) A wound first-care assessment (act flagged `excludesMci`) cannot be
// associated with the MCI allowance — the MCI drops to 0 when both are present.
const exceptionWoundAssessmentMci: ExceptionFn = (propositions) => {
  const hasAssessment = propositions.some((p) => flagsOf(p.act).excludesMci);
  if (!hasAssessment) {
    return (propositions);
  }
  return (
    propositions.map((p) => (
      p.act.type === ActType.MCI ? { ...p, rate: 0 } : p
    ))
  );
};

// ── Category 6 — global forfaits (nothing billed on top) ─────────────────────

// (6a) A dependency forfait (BSA/BSB/BSC) absorbs the day's acts: the MAU
// allowance can no longer be billed.
const exceptionGlobalDependencyForfait: ExceptionFn = (propositions) => {
  const BSI_FORFAITS = new Set([ActType.BSA, ActType.BSB, ActType.BSC]);
  const hasForfait = propositions.some((p) => BSI_FORFAITS.has(p.act.type));
  if (!hasForfait) {
    return (propositions);
  }
  return (
    propositions.map((p) => (
      p.act.type === ActType.MAU ? { ...p, rate: 0 } : p
    ))
  );
};

// (6b–6d) A global forfait act declares, through `flags.absorbsTypes`, the
// allowance/majoration types it suppresses (IPA forfait → MN/MF/MIE/MCI/MAU;
// infusion surveillance forfait → IFD/MN/MF; IC/BPCO session → MN/MF). Every act
// whose type is absorbed by a present forfait drops to rate 0.
const exceptionGlobalForfait: ExceptionFn = (propositions) => {
  const absorbed = new Set<ActType>();
  propositions.forEach((p) => flagsOf(p.act).absorbsTypes.forEach((t) => absorbed.add(t)));
  if (absorbed.size === 0) {
    return (propositions);
  }
  return (
    propositions.map((p) => (
      absorbed.has(p.act.type) ? { ...p, rate: 0 } : p
    ))
  );
};

// ── Category 7 — miscellaneous ───────────────────────────────────────────────

// (7b) An act flagged `excludesFirstOccurrence` is not billable on its very first
// occurrence (e.g. the first intrathecal/peridural analgesic injection belongs to
// the physician): rate 0 when the history shows no prior occurrence.
const exceptionFirstOccurrenceExcluded: ExceptionFn = (propositions, ctx) => {
  const occurrences = ctx.history?.occurrences ?? {};
  return (
    propositions.map((p) => {
      if (flagsOf(p.act).excludesFirstOccurrence && (occurrences[p.act.id] ?? 0) === 0) {
        return ({ ...p, rate: 0 });
      }
      return (p);
    })
  );
};

// (7c) An act flagged `priorAgreementRequired` is only reimbursed once the prior
// agreement (AP) is granted: rate 0 while its id is absent from ctx.priorAgreements.
const exceptionPriorAgreement: ExceptionFn = (propositions, ctx) => {
  const granted = new Set(ctx.priorAgreements ?? []);
  return (
    propositions.map((p) => {
      if (flagsOf(p.act).priorAgreementRequired && !granted.has(p.act.id)) {
        return ({ ...p, rate: 0 });
      }
      return (p);
    })
  );
};

// ── Category 4 — billing caps (per day / month / year / episode / sessions) ──

// An act flagged with `capMax` over a `capPeriod` is no longer billable once its
// history already reaches the cap: it drops to rate 0. The period itself is
// resolved upstream when building `ctx.history.occurrences` (which already counts
// only the occurrences inside the relevant window). Each cap case (penile sheath
// 1/24h, wound assessment 1/year, topical analgesia 8/episode, …) is data: set
// `capMax` + `capPeriod` on the act in NGAP.json.
const exceptionCaps: ExceptionFn = (propositions, ctx) => {
  const occurrences = ctx.history?.occurrences ?? {};

  return (
    propositions.map((p) => {
      const { capMax } = flagsOf(p.act);
      if (capMax !== null && (occurrences[p.act.id] ?? 0) >= capMax) {
        return ({ ...p, rate: 0 });
      }
      return (p);
    })
  );
};

// ── Category 5 — prescription derogations ────────────────────────────────────

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// An act requiring a prescription is billable only if a valid one covers it.
// Derogations loosen "covered": (5a) an "until healing" prescription covers any
// dressing for up to 3 months; (5c) such a prescription also covers the wound
// assessment; (5b) the intermediate BSI (DI type) needs no new prescription. An
// act that requires a prescription but is covered by none drops to rate 0.
const exceptionPrescription: ExceptionFn = (propositions, ctx) => {
  const { prescription } = ctx;
  const now = ctx.today ? new Date(ctx.today) : new Date();

  const isUntilHealingValid = (): boolean => {
    if (prescription === undefined || !prescription.untilHealing) {
      return (false);
    }
    return (now.getTime() - new Date(prescription.date).getTime() <= 3 * MONTH_MS);
  };

  const isCovered = (act: Act): boolean => {
    if (act.type === ActType.DI) {
      return (true); // 5b — intermediate BSI tied to the last prescription
    }
    if (prescription === undefined) {
      return (false);
    }
    if (prescription.coveredActIds.includes(act.id)) {
      return (true);
    }
    // 5a / 5c — an "until healing" prescription covers dressings and the assessment.
    const isDressingLike = act.family === 'PANSEMENT_COURANT'
      || act.family === 'PANSEMENT_LOURD_COMPLEXE';
    return (isDressingLike && isUntilHealingValid());
  };

  return (
    propositions.map((p) => {
      if (flagsOf(p.act).prescriptionRequired && !isCovered(p.act)) {
        return ({ ...p, rate: 0 });
      }
      return (p);
    })
  );
};

// ── Category 2 — specific 50% cumul explicitly allowed ───────────────────────

const PAIR_RATES = [1, 0.5, 0];

// Ranks the acts of one protected pair on their own 100% / 50% scale (3rd+ at 0),
// shielded from the general 11B abatement. The caller selects the pair.
const rankProtectedPair = (propositions: Proposition[], pair: ProtectedPair): Proposition[] => {
  const isMember = (p: Proposition): boolean => flagsOf(p.act).protectedPair === pair;
  const rateById = new Map(
    propositions
      .filter(isMember)
      .sort((a, b) => b.act.coefficient - a.act.coefficient)
      .map((p, i) => [p.act.id, PAIR_RATES[i] ?? 0]),
  );
  return (
    propositions.map((p) => (
      isMember(p) ? { ...p, rate: rateById.get(p.act.id) ?? 0 } : p
    ))
  );
};

// 2a. Bilateral mammary surgery dressing (AMI 3): 2 acts billable, the 2nd at 50%.
const cumulBilateralMammaryDressing: ExceptionFn = (propositions) => (
  rankProtectedPair(propositions, 'mammary')
);

// 2b. Postop dressing of multiple varices exeresis (AMI 3): up to 2 acts, 2nd at 50%.
const cumulVaricesExeresisDressing: ExceptionFn = (propositions) => (
  rankProtectedPair(propositions, 'varices')
);

// 2c. Inside a dependency forfait (BSA/BSB/BSC): an IM/ID/SC injection — including
//     the SC insulin injection plus surveillance — is billed at 50%.
const cumulInjectionsInsideDependencyForfait: ExceptionFn = (propositions) => {
  const BSI_FORFAITS = new Set([ActType.BSA, ActType.BSB, ActType.BSC]);
  const INJECTIONS = new Set([ActType.AMI, ActType.AMX]);
  const hasForfait = propositions.some((p) => BSI_FORFAITS.has(p.act.type));
  if (!hasForfait) {
    return (propositions);
  }
  return (
    propositions.map((p) => (
      INJECTIONS.has(p.act.type) ? { ...p, rate: 0.5 } : p
    ))
  );
};

// Every other category is data-driven and handled by the engines defined above.
// Each clinical case maps to the flags / context to populate on its act, rather
// than to its own near-identical function:
//   1a-1d  article11BApplicable: false             (venous puncture, home vaccination…)
//   3a-3b  mutuallyExclusive + family              (article-10 surveillance)
//   3c-3f  nonCumulableWith / cumulForbidden       (bladder education, infusion removal…)
//   3g     excludesMci                             (wound assessment vs MCI)
//   4a-4p  capMax + capPeriod + ctx.history        (penile sheath 1/24h, bilan 1/an…)
//   5a-5c  prescriptionRequired + ctx.prescription (until-healing, intermediate BSI…)
//   6a     BSA/BSB/BSC present                     (dependency forfait absorbs MAU)
//   6b-6d  absorbsTypes                            (IPA / infusion / IC-BPCO forfaits)
//   7a     article11BApplicable: false             (home vaccination)
//   7b     excludesFirstOccurrence + ctx.history   (intrathecal/peridural injection)
//   7c     priorAgreementRequired + ctx.priorAgreements (acts under prior agreement)

// ─── Pipeline ─────────────────────────────────────────────────────────────────

// Exceptions chain in order — changing the order changes priority. The active
// rate logic runs first; the named per-case hooks follow for traceability.
const EXCEPTIONS: ExceptionFn[] = [
  // Category 2 — protected pairs first, so they keep their own 100% / 50% scale
  // before the general 11B abatement ranks the remaining acts.
  cumulBilateralMammaryDressing,
  cumulVaricesExeresisDressing,
  // 11B abatement and the dependency (BSI) transformation.
  exception11B,
  exceptionBSI,
  cumulInjectionsInsideDependencyForfait,
  // Category 3 — non-cumulable acts.
  exceptionNonCumulable,
  exceptionFamilyMutualExclusion,
  exceptionWoundAssessmentMci,
  // Category 7 — first-occurrence exclusion and prior-agreement gating.
  exceptionFirstOccurrenceExcluded,
  exceptionPriorAgreement,
  // Category 4 — billing caps (needs ctx.history).
  exceptionCaps,
  // Category 5 — prescription derogations (needs ctx.prescription).
  exceptionPrescription,
  // Category 6 — global forfaits absorb allowances/majorations last.
  exceptionGlobalDependencyForfait,
  exceptionGlobalForfait,
];

const applyExceptions = (propositions: Proposition[], ctx: PatientContext): Proposition[] => (
  EXCEPTIONS.reduce((acc, fn) => fn(acc, ctx), propositions)
);

// ─── Finalization ─────────────────────────────────────────────────────────────

const finalizePropositions = (propositions: Proposition[]): ActResult[] => (
  propositions.map((p) => ({
    id: p.act.id,
    type: p.act.type,
    coefficient: p.act.coefficient,
    rate: p.rate,
    amount: Math.round(p.act.coefficient * p.rate * LETTER_VALUE[p.act.type] * 100) / 100,
  }))
);

// ─── Main calculation ─────────────────────────────────────────────────────────

export const calculateNGAP = (acts: Act[], context: PatientContext): ActResult[] => {
  const base = buildDefaultPropositions(acts);
  const final = applyExceptions(base, context);
  return (finalizePropositions(final));
};
