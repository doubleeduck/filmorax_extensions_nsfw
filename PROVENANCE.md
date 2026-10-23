# Provenance

The canonical JSON reader, SemVer ordering, strict ZIP verification building
blocks, package-format helper and app-owned source_js_engine are adapted from
the owner's local MangaLaunch projects, as requested for this migration.
MangaLaunch source implementations are not included in FilmoraX packages.
Those project files are not relicensed here as open source.

QuickJS-NG v0.17.0 is vendored separately under third_party/quickjs_ng with its
original MIT LICENSE and upstream commit recorded in UPSTREAM.md. Its std/os
library, sockets and native module loader are not linked into the worker.

No production signing key or publisher approval is provided by this repository.
