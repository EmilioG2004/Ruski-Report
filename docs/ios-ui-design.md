# iOS Live Scores UI

## Direction

Ruski Report uses a score-first information hierarchy inspired by modern live
sports apps such as Real while retaining its own navy, red, and light-surface
identity. The design emphasizes fast scanning rather than copying another
product's branding or feature set.

The primary hierarchy is:

1. Home is a live score feed for the active official tournament.
2. Tournament is a hub for games, overview, pods, bracket, and statistics.
3. Match is a game center with a persistent score header and selectable
   Overview, Plays, Scorecard, and Chat panels.

## Reusable Building Blocks

- `AppColors` provides semantic, light/dark adaptive brand, background,
  surface, inset, live, and final colors.
- `AppSurface` provides card, elevated, and inset containers without coupling
  feature views to concrete background colors.
- `AppPickerRail` renders a horizontally scrolling feature selector. New
  tournament or match features can be added without compressing every option
  into a fixed-width segmented control.
- `MatchScoreCard` renders scheduled, live, and final games consistently on
  Home and Tournament screens.
- `TeamMonogramView`, `AppSectionHeader`, and `AppMetricTile` keep identity,
  hierarchy, and summary data consistent across features.
- Feature-specific copy types and semantic `AppLayout`/`AppVisualTokens` keep
  content terminology and measurements out of individual view bodies.

These primitives accept domain models or small pieces of display data. They do
not fetch data or own navigation, so future modules can reuse them.

## Extending Match Detail

`MatchDetailPanel` is the navigation contract for game-center content. A future
feature such as media, predictions, lineups, or advanced analytics should:

1. Add a new enum case with a title and SF Symbol.
2. Add its content branch in `MatchDetailView.panelContent`.
3. Keep feature-specific state and loading behavior inside that panel.
4. Add a stable `match.panel.*` accessibility identifier and UI test.

The score header remains visible above every panel, so users retain match
context while moving between different data types.

Each non-chat destination uses `MatchPanelScrollView`. Chat owns a separate
scroll view with `MatchCommentComposerBar` installed through `safeAreaInset`,
and `MatchCommentModerationCoordinator` isolates reporting and blocking flow.

## Responsive Rules

- Team and player names may wrap; score columns keep priority and never depend
  on truncating the team name to remain aligned.
- Dense scorecards, statistics, and brackets scroll horizontally within their
  own panels.
- Feature selectors scroll horizontally rather than shrinking labels below a
  readable size.
- Page content is capped at `AppLayout.maximumContentWidth` while retaining
  compact iPhone padding.
- System typography and semantic colors preserve Dynamic Type, dark mode, and
  contrast behavior.

The `longContent` preview scenario supplies intentionally long tournament,
team, location, and player names for regression testing.

## Required UI States

Before closing a release UI issue, verify:

- Home: loading, unavailable, no games, scheduled, live, and final.
- Tournament: empty and populated overview, games, pods, bracket, and stats.
- Match: loading, unavailable, scheduled, live, and final plus empty panel data.
- Comments: guest, authenticated, posting, moderation rejection, reporting,
  blocking, and empty feed.
- Account: guest, authenticated, administrator, deletion, and blocked users.

Run the primary navigation and panel UI tests on the smallest and largest
installed supported iPhone simulators. Visually review the standard and
`longContent` preview scenarios in both light and dark appearance.
