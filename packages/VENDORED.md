# Vendored packages

These three trees used to be git submodules. Railway builds from GitHub, and
its builder does not init submodules — so `main` alone could not build, and the
only thing keeping production alive was `railway up` uploading a developer's
local checkout. That is exactly the failure mode the PR → main → auto-deploy
flow exists to remove, so the contents are committed here instead.

Vendored at these upstream commits:

| Package | Upstream | Commit |
|---|---|---|
| `Vibe-Workflow` | https://github.com/SamurAIGPT/Vibe-Workflow.git | `d6d15da` |
| `Open-Poe-AI` | https://github.com/Anil-matcha/Open-Poe-AI.git | `0e9f0c2` |
| `Open-AI-Design-Agent` | https://github.com/Anil-matcha/Open-AI-Design-Agent | `ebc0ce7` |

To pull upstream changes, diff against the relevant repo at the commit above,
apply what you want, and update this table.
