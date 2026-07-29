# Apps Script router recovery report

Date: 2026-07-28

## Outcome

The production router source was not recoverable with the credentials currently
available to `clasp` and Google Drive.

The deployed endpoint documented by the recovered Cloud Run source is still
reachable and returns a JSON object with `ok` and `error` fields when queried
without its shared secret. No secret or production data was sent.

Its deployment identifier has this SHA-256 fingerprint:

```text
ae92cd5222fb26edc67c00e871a6075324a9ca75174fcfaec03a0296dfb31243
```

## Candidate investigation

`clasp list` returned six accessible projects. None contains a Visual Identity
OS web router or the actions used by the MCP.

The project titled `VISUAL OS` was downloaded because it was the strongest
name match. It was rejected because:

- it contains only `renameToCanonNames`;
- it has no `doGet` or `doPost`;
- it contains no MCP action names;
- its deployment returns an HTML 404 rather than the router JSON contract;
- its deployment fingerprint differs from the baseline fingerprint.

The rejected source was not retained in the integration repository because it
contains unrelated Drive automation and project identifiers. It remains
recoverable from its original Apps Script project. Evidence fingerprints:

```text
source_sha256=98c0d7944c25ee9d1dc456b329ea8fde83a40a7fe4b68e070bef0c789dd4fe10
manifest_sha256=fc65023664fd2b91d041ab06b35b53783bd47b270077a0fd64a7ce6eb4d6916a
script_id_sha256=3c9d4a784db1ecdafd384a0aeb8a48ce28d7f1883e15b74551c9ab28b3a9cc42
deployment_id_sha256=de7e06f885630bc42e46ed3b58272b071d741931730cf74970814701b036f1f5
```

## Access findings

- `clasp 3.3.0` is authenticated.
- The target router project is not visible in `clasp list`.
- Google Drive metadata search exposed no additional Apps Script projects.
- Google Cloud CLI has no active account or project configured.
- The Apps Script deployment identifier cannot be converted into a source
  project identifier through the available read APIs.

## Safety

- No Apps Script project was created, changed, versioned, or deployed.
- No Script Property was read or modified.
- No Google Sheet or production record was accessed.
- No shared secret was displayed or sent.
- No production request, session, scoring job, or image decision was created.

## Required access to continue

One of the following is required:

1. read access to the Apps Script project that owns the baseline deployment;
2. its exact Apps Script project ID;
3. a source export supplied by the owner; or
4. a Google Cloud identity with read access to the project hosting the Cloud
   Run service, so its configured deployment can be correlated without exposing
   environment values.
