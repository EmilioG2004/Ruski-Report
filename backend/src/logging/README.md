# Logging

Logging abstractions and adapters belong here. Runtime code should log through a
shared abstraction instead of ad hoc console calls.

Use `AppLogger` in services, ingestion workflows, repositories, and realtime
code. The console implementation is the only place that should write directly to
`console`.
