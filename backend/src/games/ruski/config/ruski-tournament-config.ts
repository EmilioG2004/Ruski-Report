export const ruskiTournamentConfig = {
  podCount: 8,
  teamsPerPod: 4,
  bracketSize: 16,
  identity: {
    shootingPercentageTolerance: 0.000000001,
    aliasWeight: 2,
    rosterWeight: 1.25,
    fuzzyPlayerWeight: 0.35,
    minimumResolutionScore: 0.55,
    minimumTeamLabelScore: 0.45,
    minimumFallbackRosterScore: 0.25
  }
} as const;
