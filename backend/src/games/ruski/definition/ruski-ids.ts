export const RUSKI_GAME_TYPE = "ruski";

export const RUSKI_PHASE_IDS = {
  guy2guy: "guy2guy",
  normal: "normal",
  redemption: "redemption",
  overtime: "overtime"
} as const;

export const RUSKI_EVENT_TYPE_IDS = {
  miss: "miss",
  make: "make",
  splashOut: "splash-out",
  guy: "guy",
  tri: "tri",
  di: "di",
  vom: "vom"
} as const;

export const RUSKI_STAT_KEYS = {
  makes: "makes",
  misses: "misses",
  shootingPercentage: "shootingPercentage",
  splashOuts: "splashOuts",
  guys: "guys",
  tris: "tris",
  dis: "dis",
  uns: "uns",
  voms: "voms"
} as const;

export const RUSKI_STANDING_METRIC_KEYS = {
  cupDifferential: "cupDifferential",
  shootingPercentage: "shootingPercentage"
} as const;
