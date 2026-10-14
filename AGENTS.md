# Repository workflow

- The default integration branch is `dev`.
- Start feature work on `feat/<description>` and fixes on `fix/<description>`, based on `dev`.
- Complete appropriate checks before merging a work branch into `dev`.
- Keep the checkout on `dev` after integration unless active work needs its own branch.
- Do not commit, merge, rebase, reset, or push `main` unless the user explicitly authorizes that action. The user manages promotion from `dev` to `main`.
- Do not force-push `dev` or `main`.
- Keep local Wi-Fi credentials, device keys, runtime files, build output, and generated firmware binaries out of commits. Factory firmware is built by CI and included in the frontend artifact.
