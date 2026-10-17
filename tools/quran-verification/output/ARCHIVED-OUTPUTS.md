# Archived King Fahd verification outputs

On 2026-10-17 (repository audit, item C2) the five King Fahd (KFGQPC Hafs v2.0) comparison outputs below were removed from
Git tracking and preserved byte for byte in the owner's private audit archive outside the repository (`My App/Working progress/Audit Reports/repository-cleanup-2026-10-17/`, next to the earlier repository-excluded review images). They are unchanged historical evidence of the
[source decision](../README.md): Tanzil Uthmani 1.1 is canonical; King Fahd is an independent reference only.

**Why they left the public tree.** They contain the King Fahd Quran text itself (`kfgqpc-comparison.json` holds every
ayah's King Fahd text; the reports and the analysis quote it), and the package's terms for redistributing that text are
unresolved (the comparison's own licensing record: "no explicit dataset redistribution terms located"). This summary
holds no Quran text.

**They cannot be regenerated here:** `compare-kfgqpc.mjs` and `orthographic-analysis.mjs` need the original
`UthmanicHafs_v2-0.zip` (SHA-256 `a7b0e559…d72c`), which is not in the repository or on this machine. Keep the private
archive.

**What still reads them:** only those two research scripts and `orthographic-analysis.test.mjs` (none in CI, the app or
the backend). `compare-kfgqpc.mjs` also reads `kfgqpc-pdf-inspection.json` as an input. Restore the files (below) before
running them.

**Still in Git history:** removing them from the tree does not remove them from earlier commits, which stay public
(see "Added in"). Removing them from history needs a separately approved history rewrite and force-push.

The historical preparation reports `report.md` and `report.json` stay tracked: they hold no Quran text.

| File | Bytes | SHA-256 (committed object) | Added in |
|---|---:|---|---|
| `kfgqpc-comparison-report.md` | 9,357,181 | `cc476f13331035914369c06c7a8042c78394638cd0f8e167ccbdfdab2fb5edf7` | `cca158f` |
| `kfgqpc-comparison.json` | 18,658,919 | `055b2a9ee43b757c2781fdf273dcde8022eab681198f45ed06b6941dd09fd201` | `cca158f` |
| `kfgqpc-orthographic-analysis.json` | 71,437,051 | `f17fb3e97fdffc2fa20d235c1363138458a5f63a38057a6ccc517caeb5fb5fdf` | `cca158f` |
| `kfgqpc-orthographic-analysis.md` | 5,085,530 | `05caf11e87b38d1e950bfee5339741e1679ee85740d40a41b231a46540c1f440` | `cca158f` |
| `kfgqpc-pdf-inspection.json` | 330,709 | `f1173a4b8a2106eb3d407229de7ce618e5e1d965e408efe2dee10a5e735ac593` | `cca158f` |

Machine-readable: [`archived-outputs.json`](archived-outputs.json). Total 104,869,390 bytes; HEAD when archived:
`4e35aca7ddabf30f1614f25aa403de03a19a9783`.

## Restoring

1. Copy the archived files back to their original paths (from the archive folder: `cp -R "<archive>/king-fahd-verification-output/." "<repo>/"`, or
   `robocopy "<archive>\king-fahd-verification-output" "<repo>" /E` on Windows). They stay git-ignored: never re-commit them while their
   redistribution terms are unresolved.
2. Verify them: `node tools/quran-verification/verify-private-archive.mjs tools/quran-verification/output/archived-outputs.json` from the repository root (exit 0 =
   every file present with its recorded SHA-256; a Windows CRLF checkout copy of a text file is recognised as such).
3. If the private archive were ever lost, the identical bytes remain in Git history:
   `git show <added-in commit>:<path> > <path>`.
