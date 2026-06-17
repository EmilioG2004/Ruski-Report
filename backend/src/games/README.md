# Games

Game modules and plugins belong here. V1 will add a Ruski plugin that parses,
validates, normalizes, and calculates stats for the official scorebook format.

The generic backend depends on the `GamePlugin` interface and
`GamePluginRegistry`, not on concrete game implementations. Game-specific
modules should convert their source data into the framework-free domain models
before persistence or API layers use the data.
