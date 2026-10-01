# T4 native validation matrix

All three profiles in `native-profiles.json` passed on clean checkout `2f2dc390aee3b9fa49efa3d1c215aa72a4b1690d`. The T4 commit changes validation/CI documentation and harnesses, **not** analyzer or native regression source. The recorded `src`/`test` tree IDs match the T3 implementation and can be compared directly with the delivery commit.

| Profile | Distribution | Node | Qt | Result |
| --- | --- | --- | --- | --- |
| pinned-nix | NixOS 26.05, pinned flake | 24.15.0 | 6.11.0 | pass |
| ubuntu-minimum | Ubuntu 24.04 | 24.4.0 | 6.4.2 | pass |
| ubuntu-current | Ubuntu 24.04 | 24.18.0 | 6.4.2 | pass |

Each ran **npm ci, 119/119 native tests (zero skipped), the six existing acceptance tests, live Qt oracle, all five native CMake/Qt scenarios and installed-package/CMake smoke without optional peers**. The new driver's two fail-closed regression tests also ran in each environment. The combined acceptance suite in the delivery worktree has eight tests. Raw command exits are all zero; complete log hashes, actual versions, source trees, driver/plan hashes and integration scenario outcomes are committed in `trust-t4-results/{pinned-nix,ubuntu-minimum,ubuntu-current}.json`.

`native_profile.py` refuses dirty checkouts and mismatched versions/distributions. It requires live Qt diagnostics and every integration scenario; a skipped oracle or omitted scenario cannot count as pass. It checks tracked source and HEAD again at completion. `npm ci` installs the lockfile rather than reusing the working development installation.

These are **local executions of the native CI command matrix**, not fabricated GitHub Actions results. CI is pinned to `ubuntu-24.04` instead of the moving `ubuntu-latest` alias, matching the tested distribution. Node 24 in CI remains the current major and will continue testing future updates; this acceptance record names the exact sampled versions. The matrix does not claim Windows/macOS or aarch64 validation merely because a development shell can be evaluated there. Whole-release acceptance remains separate.

## Reproduce

On an appropriately provisioned profile, using a clean clone and a new output directory:

```sh
python3 acceptance/native_profile.py --profile ubuntu-minimum \
  --repository /path/to/clean/checkout --output /tmp/qml-native-minimum
# Or ubuntu-current with Node 24.18.0.

nix develop --offline --command python3 acceptance/native_profile.py \
  --profile pinned-nix --repository /path/to/clean/checkout \
  --output /tmp/qml-native-nix
```

The Ubuntu environment here was an actual Ubuntu userspace in a user/mount/PID namespace on the Linux host, not Nix Qt pretending to be Ubuntu Qt. It used the official Ubuntu base image, Ubuntu's apt-built Qt/CMake/compiler libraries, and official Node archives. All downloads were checked against the upstream SHA-256 manifests:

| Download | SHA-256 |
| --- | --- |
| `https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-amd64.tar.gz` | `6bc2cde3930ad088b3bb46fa45279e96d25bc3810f209850ecbe4722711874f9` |
| `https://nodejs.org/dist/v24.4.0/node-v24.4.0-linux-x64.tar.xz` | `af59f88ed35c68f7196dc94938e74327e3abe62055b831746de5b23bd7e1670a` |
| `https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz` | `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742` |

Inside that rootfs, provisioning completed with exit 0 and **empty `dpkg --audit`**:

```sh
apt-get update
apt-get install -y ca-certificates python3 build-essential cmake ninja-build \
  qt6-base-dev qt6-qpa-plugins qt6-declarative-dev qt6-declarative-dev-tools \
  qml6-module-qtquick qml6-module-qtquick-window qml6-module-qtqml-workerscript \
  qml6-module-qttest qml6-module-qtquick-layouts git xz-utils
dpkg --audit
```

Installed package versions are recorded in `trust-t4-results/ubuntu-packages.txt`. The namespace launcher (paths abbreviated) was:

```sh
unshare --map-root-user --map-auto --setgroups allow \
  bwrap --unshare-pid --die-with-parent --bind "$ubuntu_root" / \
  --dev /dev --proc /proc --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --ro-bind "$verified_node_archive_directory" /opt/node \
  --ro-bind "$lens_checkout/acceptance" /harness --clearenv \
  --setenv PATH /opt/node/bin:/usr/lib/qt6/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv HOME /root --setenv LC_ALL C.UTF-8 \
  --setenv QT_QPA_PLATFORM offscreen --setenv QT_QUICK_BACKEND software \
  --setenv npm_config_nodedir /opt/node \
  /usr/bin/python3 /harness/native_profile.py --profile ubuntu-minimum \
  --repository /work/lens-minimum --output /work/results-minimum-final
```

Use an authorized subordinate UID/GID range for the namespace. Node headers come from the matching verified archive; no dependency is substituted. Do not run these rootfs provisioning commands against the host filesystem. The driver was mounted read-only into the Ubuntu environment; its regressions ran there, and the analyzer checkout remained clean.

## Investigated attempts (not counted as passing evidence)

- A single-UID namespace could not configure daemon/font ownership and could not chown extracted Node headers. Provisioning was rerun with the user's authorized subordinate UID/GID mappings, and matching bundled Node headers were supplied to node-gyp. Final apt provisioning and dpkg audit succeeded before the final profiles.
- The first Ubuntu integration inherited host Qt environment paths. Clearing the environment corrected the contamination. Final profiles use only the Ubuntu Qt path and explicit offscreen settings.
- The first additional live Shelllist repeat campaign observed ongoing source edits and rejected the third run: `QML/JavaScript sources, local CMake definitions, or configured type metadata changed during the run; rerun analysis.` This is **correct fail-closed behavior**, not normalized away or retried until a favorable hash appeared.

## Continued Shelllist measurement

Shelllist advanced during this session to `289209e168797340908f9387e9ca0977e787af8c`, with additional working-tree edits by the ongoing consumer work. No such edit was reverted or incorporated into a lens commit. A 646-file snapshot of tracked and non-ignored working files was copied with symlinks preserved; inventories before/after and copied file hashes were checked for stability. `shelllist-snapshot.json` records HEAD, dirty paths and the full inventory digest.

That fixed snapshot was mounted read-only at `/consumer`, and the existing `determinism.py` was run against its own `qmlqualitylens.config.json` in both Ubuntu Node profiles. Each passed **three fresh runs × 26 artifacts**. Both observed source hash `b0d823b8999ac52e3b45e28fe95cfebadca0058d4f41e1482906223a61e79651` and the same static audit counts: 724 findings, one warning, 723 review findings, **191 required side-effect abstentions**, verdict `incomplete`. Normalized digests differ between profiles because tool versions, configuration/output paths and provenance are deliberately retained; they are identical within each profile. These results do not label the consumer findings for accuracy or claim that the changing working tree is clean.

`trust-t4-results/shelllist-{minimum,current}.json` contains the repeated observations. These runs were static and explicitly disabled consumer execution/imported reports. The preceding full live Shelllist audit, 300 passing Qt executions and strict incomplete-policy failure are recorded under T3. No application behavior claim is transferred to the newer snapshot without executing it.

Local logs/captures:

- `/tmp/qml-trust-t4-nix-results/`
- `/tmp/qml-trust-toolchains/ubuntu/work/results-{minimum,current}-final/`
- `/tmp/qml-trust-toolchains/ubuntu/work/shelllist-{minimum,current}-snapshot/`
- `/tmp/qml-trust-toolchains/ubuntu-provision-final.log` (SHA-256 `1ddffb43d0f61ffbfc8905cc605a5e909c15a8c27d451ab875f46a949c72218a`)
- `/tmp/qml-trust-shelllist-snapshot/` and `/tmp/qml-trust-snapshot.py`
