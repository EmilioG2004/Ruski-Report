# Domain

Framework-free tournament, match, team, player, game definition, and live event
contracts belong here. These types should not depend on NestJS, HTTP DTOs, Excel
parsing, or database implementation details.

Game-specific terms such as Ruski `di`, `tri`, `guy`, or `vom` belong in
`GameDefinition`, `GameEvent`, scorecard definitions, and box-score stat keys,
not as hardcoded fields on generic tournament or match models.
