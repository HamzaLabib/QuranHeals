# Comparison images (local only)

The experiment's 17 comparison images (14 side-by-side panels and 3 sets of 1:1 crops of pages 4 and 604) are QCF V1 page
renders: Quran Foundation content whose fonts may be used only inside the app. On 2026-10-17 (repository audit, item C1) they
were removed from Git tracking; `.gitignore` keeps them out. They remain in this folder on the owner's machine, and a
byte-for-byte copy is in the owner's private audit archive outside the repository (`My App/Working progress/Audit Reports/repository-cleanup-2026-10-17/`, next to the earlier repository-excluded review images). They are evidence only: nothing builds, tests or restores from them.

Earlier commits still contain them (see "Added in").

| File | Bytes | SHA-256 (committed object) | Added in |
|---|---:|---|---|
| `01-page004-original-vs-best-C.png` | 592,840 | `526b8bab1f64febbd82d7e31c9abeec9d86fe4f46dbc8346b34cda847a1e11ad` | `78fcd0d` |
| `02-page604-original-vs-best-C.png` | 528,471 | `e0314e63e37edb018fd837829339a10eb08c892daf3272901dd19cc0ed8f9ddd` | `78fcd0d` |
| `03-page004-original-vs-3pct.png` | 584,622 | `dcb1f3ba7d3d8ea78ec70fd9d4f68113624559ea45eead131e398ddbabd67cbd` | `78fcd0d` |
| `04-page004-original-vs-5pct.png` | 591,438 | `61407e69589e687efb17eba39d0fce57ee4518857054ee105894f2e50ff6c7b2` | `78fcd0d` |
| `05-page004-original-vs-8pct-FAIL.png` | 601,064 | `cce8f0ffda28b3b3eea4d1f9cad2290bc2b09e6a76f811400d8e0d6c5b326f9e` | `78fcd0d` |
| `06-page604-original-vs-3pct.png` | 523,683 | `1588d67b83990a551b772045ad3518c54860d132a39a8f54d51f1420e74a66c5` | `78fcd0d` |
| `07-page604-original-vs-8pct-FAIL.png` | 531,020 | `a294ce475ea07ec936dc253cb3175c1a0a970104107f81b79b486e896927836a` | `78fcd0d` |
| `08-page004-all-candidates-iphone14.png` | 720,326 | `df640972a04da395d92c9c004ad8953828acb5ef10cec1a07a2b904195d07a81` | `78fcd0d` |
| `09-page604-all-candidates-iphone14.png` | 546,542 | `20e722d359be43850bfea45ff731e6e746f909a6c7f91e0cb5ca8fd72c7a2a23` | `78fcd0d` |
| `10-page004-small-iphone-se.png` | 550,319 | `aa1224802f4e1fd9358d5f1301ef0f9930e04cc9949ec566313ed1fa5dfb069f` | `78fcd0d` |
| `11-page004-large-iphone-16-pro-max.png` | 580,056 | `01171b1efdb9a48638b60557f5627bd79669acbf25de7fc4dad738da24866836` | `78fcd0d` |
| `12-page004-android-pixel.png` | 620,452 | `229b0dbb621739c37d88ddd077d9c72146c35f2e3ef65d0e75c26135a71f9fd8` | `78fcd0d` |
| `13-page604-dark.png` | 504,101 | `e8ca136812d951d3cb58c42f73c25941a70633cab95403e1234993aceb823805` | `78fcd0d` |
| `14-page004-dark.png` | 573,745 | `fb33500e833d6108a8b48615a0d26b6b82d7370e13d31fe9c4c5c7a2a39a2f75` | `78fcd0d` |
| `20-crop-right-edge-page004.png` | 418,542 | `9842fa7dfc2c547863caddfd4f8e53918e5511fb8592d26c105484581c4f5eb7` | `78fcd0d` |
| `21-crop-line-middle-page004.png` | 275,326 | `2900880f10f1e9066c3e2e75e33ebc116c75b2b3872e078a55f2c30a56e8d4e4` | `78fcd0d` |
| `22-crop-right-edge-page604.png` | 384,151 | `69afd1a4846ae49f73ecd771e8235245037c969e4a10d9fad3633aeaf2dec22f` | `78fcd0d` |

Machine-readable: [`archived-images.json`](archived-images.json). Total 9,126,698 bytes.

## Restoring

1. Copy the archived files back to their original paths (from the archive folder: `cp -R "<archive>/larger-text-mushaf-comparisons/." "<repo>/"`, or
   `robocopy "<archive>\larger-text-mushaf-comparisons" "<repo>" /E` on Windows). They stay git-ignored: never re-commit them while their
   redistribution terms are unresolved.
2. Verify them: `node tools/quran-verification/verify-private-archive.mjs design-archive/experiments/larger-text-mushaf/comparisons/archived-images.json` from the repository root (exit 0 =
   every file present with its recorded SHA-256; a Windows CRLF checkout copy of a text file is recognised as such).
3. If the private archive were ever lost, the identical bytes remain in Git history:
   `git show <added-in commit>:<path> > <path>`.
