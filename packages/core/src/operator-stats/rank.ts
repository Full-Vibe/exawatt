import type {
  LeaderboardAxis,
  RankableOperator,
  RankedOperator,
} from './types';

export function leaderboardValue(
  operator: RankableOperator,
  axis: LeaderboardAxis
): number {
  switch (axis) {
    case 'command':
      return operator.agentMs;
    case 'endurance':
      return operator.longestHandsOffMs;
    case 'fleet':
      return operator.peakFleet;
    case 'energy':
      return operator.normalizedTokens;
  }
}

export function rankOperators(
  operators: readonly RankableOperator[],
  axis: LeaderboardAxis
): RankedOperator[] {
  const sorted = [...operators].sort((left, right) => {
    const valueDifference =
      leaderboardValue(right, axis) - leaderboardValue(left, axis);
    if (valueDifference) return valueDifference;
    const joinedDifference = left.joinedAt.localeCompare(right.joinedAt);
    if (joinedDifference) return joinedDifference;
    return left.handle.localeCompare(right.handle);
  });
  return sorted.map((operator, index) => ({
    ...operator,
    rank: index + 1,
    value: leaderboardValue(operator, axis),
  }));
}
