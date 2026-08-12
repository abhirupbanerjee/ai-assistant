# Public upstream contracts

These runtime validators intentionally model only fields published by AI Assistant HTTP endpoints.
Unknown response fields are ignored and gain no authority. Discovery does not currently publish
enum, string-length, pattern, numeric-range, array-item, or object-property constraints; therefore,
the portal must not infer or promise those private constraints. The upstream invocation endpoint
remains the final validator.

Sanitized fixtures under `tests/fixtures/` contain no credentials, private source data, or stable
application imports. Replace or extend fixtures only with similarly sanitized captures.
