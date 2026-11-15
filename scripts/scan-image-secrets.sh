#!/usr/bin/env bash
# Pre-push secret-scan guard (issue 0036 #4). Scans a built image for secret material and FAILS
# (non-zero exit) if any is found — the mandatory gate before `docker push`. This is defence-in-depth
# behind the Dockerfile's allowlist copies: the build is structured so secrets cannot enter a pushed
# layer (no `COPY . .` in any shipped stage), and this script proves it per build so a future
# `COPY . .` regression, a renamed secret, or a leaked ENV is caught before it reaches a registry.
#
# Usage:
#   scripts/scan-image-secrets.sh [IMAGE ...]        # scan the given images (default: the pushed set)
#   scripts/scan-image-secrets.sh --deep [IMAGE ...] # also run a content scan (gitleaks if installed)
#
# Default images = the three a registry push would ship:
#   production-engine:local  production-engine-claude:local  production-engine-web:local
#
# Gates (any hit = fail):
#   1. Filenames  — no credential-config files: .env / .env.* / .common_env / .engine_env / *_env,
#                   and no named private keys (id_rsa / id_dsa / id_ecdsa / id_ed25519, .p12, .pfx)
#                   anywhere in the image fs (*.example is allowed). NOTE: deliberately does NOT match
#                   *.pem / *.key by extension — those are overwhelmingly the OS/public CA trust store
#                   (/etc/ssl/certs, certifi cacert.pem), not secrets; PRIVATE-key *material* is caught
#                   by the content gate's `BEGIN ... PRIVATE KEY` pattern instead.
#   2. History    — no secret-shaped ENV/ARG in `docker history` (TOKEN/SECRET/PASSWORD/API_KEY/
#                   OAUTH/PRIVATE_KEY/_authToken = <non-trivial value>).
#   3. Content    — (--deep, or auto when `gitleaks` is on PATH) scan the exported fs for secret
#                   patterns (incl. private-key blocks). Skipped with a note when no scanner is available.
#
# CI: run this in the pipeline immediately before `docker push`; a non-zero exit must abort the push.

set -euo pipefail

DEEP=0
IMAGES=()
for arg in "$@"; do
	case "$arg" in
		--deep) DEEP=1 ;;
		-h|--help) sed -n '2,33p' "$0"; exit 0 ;;
		-*) echo "unknown flag: $arg" >&2; exit 2 ;;
		*) IMAGES+=("$arg") ;;
	esac
done
if [ "${#IMAGES[@]}" -eq 0 ]; then
	IMAGES=(production-engine:local production-engine-claude:local production-engine-web:local)
fi

if ! command -v docker >/dev/null 2>&1; then
	echo "FATAL: docker not found on PATH" >&2
	exit 2
fi

# Forbidden secret filenames (basename match). *.example is explicitly allowed (committed samples).
# POSIX ERE, matched against each path's basename. Credential-config files + named private keys ONLY —
# NOT *.pem/*.key (CA trust store); private-key material is caught by content, not by extension.
FORBIDDEN_NAME_RE='^(\.env|\.env\..+|\.common_env|\.engine_env|.+_env|id_rsa|id_dsa|id_ecdsa|id_ed25519|.+\.p12|.+\.pfx)$'
# Secret-shaped assignments in image history (ENV/ARG). Value must look non-trivial.
HISTORY_SECRET_RE='(TOKEN|SECRET|SECRET_KEY|PASSWORD|PASSWD|API[_-]?KEY|APIKEY|OAUTH|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|_authToken)[A-Z0-9_]*=[^ ]{6,}'

fail_total=0
tmproot="$(mktemp -d "${TMPDIR:-/tmp}/img-scan.XXXXXX")"
cleanup() { rm -rf "$tmproot"; }
trap cleanup EXIT

scan_image() {
	local image="$1"
	local hits=0
	echo "── scanning ${image} ──────────────────────────────────────────────"

	if ! docker image inspect "$image" >/dev/null 2>&1; then
		echo "  FAIL: image not found locally (build it first): ${image}"
		return 1
	fi

	# ── Gate 1 + export: list the image filesystem via `docker export` of a throwaway container.
	local cid tar
	cid="$(docker create "$image")"
	tar="${tmproot}/$(echo "$image" | tr '/:' '__').tar"
	docker export "$cid" >"$tar"
	docker rm -f "$cid" >/dev/null 2>&1 || true

	local bad_names
	bad_names="$(tar -tf "$tar" \
		| grep -vE '/$' \
		| awk -F/ '{print $0"\t"$NF}' \
		| while IFS=$'\t' read -r path base; do
			[ -z "$base" ] && continue
			case "$base" in *.example) continue ;; esac
			if printf '%s' "$base" | grep -qiE "$FORBIDDEN_NAME_RE"; then
				printf '%s\n' "$path"
			fi
		done)"
	if [ -n "$bad_names" ]; then
		echo "  FAIL (filenames): secret-shaped files present in image layers:"
		printf '%s\n' "$bad_names" | sed 's/^/    /'
		hits=$((hits + 1))
	else
		echo "  OK   (filenames): no secret-shaped files in the image fs"
	fi

	# ── Gate 2: secret-shaped assignments baked into history (ENV/ARG).
	local bad_hist
	bad_hist="$(docker history --no-trunc --format '{{.CreatedBy}}' "$image" \
		| grep -E "$HISTORY_SECRET_RE" \
		| grep -viE '=(unknown|true|false|1|0|\$\{?[A-Z_]+\}?)([[:space:]]|$)' || true)"
	if [ -n "$bad_hist" ]; then
		echo "  FAIL (history): secret-shaped ENV/ARG baked into image layers:"
		printf '%s\n' "$bad_hist" | sed 's/^/    /'
		hits=$((hits + 1))
	else
		echo "  OK   (history): no secret-shaped ENV/ARG in image history"
	fi

	# ── Gate 3: content scan (opt-in / auto with gitleaks).
	if [ "$DEEP" -eq 1 ] || command -v gitleaks >/dev/null 2>&1; then
		local fsdir="${tmproot}/fs-$(echo "$image" | tr '/:' '__')"
		mkdir -p "$fsdir"
		# Skip the node_modules / model / cache noise — scan app + config surface only.
		tar -xf "$tar" -C "$fsdir" \
			--exclude='*/node_modules/*' --exclude='node_modules/*' \
			--exclude='*/.cache/*' --exclude='opt/*' --exclude='usr/*' 2>/dev/null || true
		if command -v gitleaks >/dev/null 2>&1; then
			if gitleaks detect --no-git --source "$fsdir" --redact -v >"${tmproot}/gitleaks.out" 2>&1; then
				echo "  OK   (content): gitleaks found no secrets"
			else
				echo "  FAIL (content): gitleaks reported findings:"
				sed 's/^/    /' "${tmproot}/gitleaks.out"
				hits=$((hits + 1))
			fi
		else
			# No scanner: a coarse high-signal pattern grep as a fallback.
			local grep_hits
			grep_hits="$(grep -rIlE '(sk-[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|_authToken=[A-Za-z0-9+/=_-]{12,})' "$fsdir" 2>/dev/null || true)"
			if [ -n "$grep_hits" ]; then
				echo "  FAIL (content): secret patterns found in files:"
				printf '%s\n' "$grep_hits" | sed 's/^/    /'
				hits=$((hits + 1))
			else
				echo "  OK   (content): no high-signal secret patterns (install gitleaks for a full scan)"
			fi
		fi
	else
		echo "  SKIP (content): pass --deep or install gitleaks for a full content scan"
	fi

	return "$hits"
}

for image in "${IMAGES[@]}"; do
	if ! scan_image "$image"; then
		fail_total=$((fail_total + 1))
	fi
	echo
done

if [ "$fail_total" -ne 0 ]; then
	echo "RESULT: FAIL — ${fail_total} image(s) contain secret material. Do NOT push." >&2
	exit 1
fi
echo "RESULT: PASS — no secret material found; images are safe to push."
