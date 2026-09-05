export type SalesStage =
  | 'discovery'
  | 'qualification'
  | 'needs'
  | 'presentation'
  | 'objection'
  | 'closing'
  | 'follow-up';

export type LeadState = {
  stage: SalesStage;
  score: number;
  signals: string[];
};

const stageOrder: SalesStage[] = [
  'discovery',
  'qualification',
  'needs',
  'presentation',
  'objection',
  'closing',
  'follow-up',
];

export function createLeadState(): LeadState {
  return { stage: 'discovery', score: 0, signals: [] };
}

export function analyzeSalesTurn(text: string, current: LeadState): LeadState {
  const value = text.toLowerCase();
  let score = current.score;
  const signals = [...current.signals];

  const rules: Array<[RegExp, number, string]> = [
    [/budget|price|cost|afford|spend|₹|\$/i, 10, 'Budget discussed'],
    [/need|problem|pain|struggle|challenge|looking for/i, 15, 'Need identified'],
    [/soon|today|this week|urgent|asap|deadline/i, 15, 'Urgency detected'],
    [/decision|boss|manager|team|approve|buy/i, 10, 'Buying authority discussed'],
    [/demo|trial|start|sign|purchase|interested|yes/i, 20, 'Buying intent detected'],
    [/expensive|too much|not worth|competitor|already use|objection/i, 5, 'Objection detected'],
  ];

  for (const [pattern, points, signal] of rules) {
    if (pattern.test(value)) {
      score = Math.min(100, score + points);
      if (!signals.includes(signal)) signals.push(signal);
    }
  }

  let stage = current.stage;
  if (/demo|trial|start|sign|purchase|yes|let's do|book/i.test(value)) stage = 'closing';
  else if (/expensive|too much|not worth|competitor|already use/i.test(value)) stage = 'objection';
  else if (/price|budget|cost|decision|approve|buy/i.test(value)) stage = 'qualification';
  else if (/need|problem|pain|struggle|challenge/i.test(value)) stage = 'needs';
  else if (score >= 30) stage = 'presentation';

  return { stage, score, signals: signals.slice(-6) };
}

export function stageLabel(stage: SalesStage) {
  return stage.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function stageIndex(stage: SalesStage) {
  return stageOrder.indexOf(stage);
}
