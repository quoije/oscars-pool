"""
Let’s Encrypt certificate issuance/renewal using Python-only certbot.

Why this exists:
- You already run the server with `uvicorn`.
- Uvicorn can serve HTTPS when given cert/key PEM files.
- The missing piece is obtaining and renewing a trusted certificate.

This module wraps the *certbot Python package* (no system `certbot` binary required).

Typical usage (standalone HTTP-01, binds to port 80):
  sudo -E python -m python_video_server.letsencrypt certonly \
    --email you@example.com \
    --domains example.com,www.example.com \
    --production

If you *cannot* bind port 80 (shared hosting, no root, port already in use),
use DNS-01 instead (manual TXT record):
  python3 -m python_video_server.letsencrypt certonly \
    --challenge dns \
    --email you@example.com \
    --domains example.com,www.example.com \
    --production

Then run uvicorn with:
  sudo -E uvicorn python_video_server.server:app --host 0.0.0.0 --port 443 \
    --ssl-certfile python_video_server/certs/config/live/example.com/fullchain.pem \
    --ssl-keyfile  python_video_server/certs/config/live/example.com/privkey.pem
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable, List


LE_PRODUCTION_DIRECTORY_URL = "https://acme-v02.api.letsencrypt.org/directory"
LE_STAGING_DIRECTORY_URL = "https://acme-staging-v02.api.letsencrypt.org/directory"


def _default_base_dir() -> Path:
    # Keep certbot state inside the repo by default (and gitignored).
    # This mirrors certbot's default directory structure:
    # - config/live/<domain>/{fullchain.pem,privkey.pem,...}
    # - config/renewal/<domain>.conf
    # - work/*
    # - logs/*
    return (Path(__file__).resolve().parent / "certs").resolve()


def _split_domains(domains_csv: str) -> List[str]:
    domains = [d.strip() for d in (domains_csv or "").split(",") if d.strip()]
    # Deduplicate while preserving order
    out: List[str] = []
    seen = set()
    for d in domains:
        if d not in seen:
            out.append(d)
            seen.add(d)
    return out


def _ensure_dirs(base_dir: Path) -> tuple[Path, Path, Path]:
    config_dir = (base_dir / "config").resolve()
    work_dir = (base_dir / "work").resolve()
    logs_dir = (base_dir / "logs").resolve()
    config_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    return config_dir, work_dir, logs_dir


def _ensure_dns_hook_scripts(work_dir: Path) -> tuple[Path, Path]:
    """
    Create small executable hook scripts used by certbot's --manual DNS flow.

    Certbot runs these hooks as external executables; we generate them under the
    certbot work dir so no special permissions are needed.
    """

    auth_hook = (work_dir / "certbot_dns_auth_hook.py").resolve()
    cleanup_hook = (work_dir / "certbot_dns_cleanup_hook.py").resolve()

    auth_contents = """#!/usr/bin/env python3
import os
import sys
import time

def _open_tty():
    # Certbot may capture stdout/stderr of hooks; /dev/tty forces user-visible IO
    # when an interactive terminal exists.
    try:
        return open("/dev/tty", "r+", encoding="utf-8", buffering=1)
    except Exception:
        return None

def main() -> int:
    domain = os.environ.get("CERTBOT_DOMAIN", "").strip()
    validation = os.environ.get("CERTBOT_VALIDATION", "").strip()
    if not domain or not validation:
        print("Missing CERTBOT_DOMAIN/CERTBOT_VALIDATION in environment.", file=sys.stderr, flush=True)
        return 2

    record_name = f"_acme-challenge.{domain}"
    msg = (
        "\\n=== DNS-01 challenge required ===\\n"
        "Create/Update this TXT record:\\n"
        f"  Name:  {record_name}\\n"
        "  Type:  TXT\\n"
        f"  Value: {validation}\\n"
        "\\nAfter the record is published and has propagated, press Enter to continue.\\n"
        "> "
    )

    tty = _open_tty()
    if tty is not None:
        tty.write(msg)
        tty.flush()
        try:
            tty.readline()
        except KeyboardInterrupt:
            tty.write("\\nAborted.\\n")
            tty.flush()
            return 130
        finally:
            try:
                tty.close()
            except Exception:
                pass
        return 0

    # Fallback: best-effort stdout + either wait or read stdin if interactive.
    print(msg, end="", flush=True)
    if not sys.stdin.isatty():
        wait_s = int(os.environ.get("LE_DNS_WAIT_SECONDS", "300"))
        print(f"\\n(non-interactive stdin detected; waiting {wait_s}s then continuing...)", flush=True)
        time.sleep(max(0, wait_s))
        return 0
    try:
        input("")
    except KeyboardInterrupt:
        print("\\nAborted.", file=sys.stderr, flush=True)
        return 130
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
"""

    cleanup_contents = """#!/usr/bin/env python3
import os

def _open_tty():
    try:
        return open("/dev/tty", "w", encoding="utf-8", buffering=1)
    except Exception:
        return None

def main() -> int:
    domain = os.environ.get("CERTBOT_DOMAIN", "").strip()
    if not domain:
        return 0
    msg = "\\nDNS-01 cleanup:\\nYou may now remove the TXT record: _acme-challenge.%s\\n" % domain
    tty = _open_tty()
    if tty is not None:
        tty.write(msg)
        tty.flush()
        try:
            tty.close()
        except Exception:
            pass
        return 0
    print(msg, end="", flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
"""

    auth_hook.write_text(auth_contents, encoding="utf-8")
    cleanup_hook.write_text(cleanup_contents, encoding="utf-8")
    os.chmod(auth_hook, 0o755)
    os.chmod(cleanup_hook, 0o755)

    return auth_hook, cleanup_hook


def _run_certbot(argv: Iterable[str]) -> int:
    try:
        # certbot is a Python package dependency (installed via pip).
        # Importing here keeps the server import path clean.
        import certbot.main  # type: ignore
    except Exception as e:
        raise SystemExit(
            "Missing dependency: certbot is not installed.\n"
            "Install it with:\n"
            "  python -m pip install -r python_video_server/requirements.txt\n"
            f"\nOriginal import error: {e!r}"
        )
    return int(certbot.main.main(list(argv)))


def _common_certbot_flags(
    *,
    email: str,
    domains: List[str],
    base_dir: Path,
    production: bool,
    non_interactive: bool = True,
) -> List[str]:
    if not email.strip():
        raise SystemExit("--email is required")
    if not domains:
        raise SystemExit("--domains is required (comma-separated)")

    config_dir, work_dir, logs_dir = _ensure_dirs(base_dir)

    args: List[str] = [
        "--agree-tos",
        "--email",
        email.strip(),
        "--config-dir",
        str(config_dir),
        "--work-dir",
        str(work_dir),
        "--logs-dir",
        str(logs_dir),
        # Keep key type modern; certbot defaults may vary by version.
        "--key-type",
        "ecdsa",
    ]
    if non_interactive:
        args.insert(0, "--non-interactive")

    if production:
        args += ["--server", LE_PRODUCTION_DIRECTORY_URL]
    else:
        args += ["--server", LE_STAGING_DIRECTORY_URL]

    for d in domains:
        args += ["-d", d]

    return args


def cmd_certonly(args: argparse.Namespace) -> int:
    base_dir = Path(args.base_dir).expanduser().resolve() if args.base_dir else _default_base_dir()
    domains = _split_domains(args.domains)
    production = bool(args.production)

    challenge = (args.challenge or "http").strip().lower()
    if challenge not in {"http", "dns"}:
        raise SystemExit("--challenge must be one of: http, dns")

    if challenge == "dns":
        # DNS-01 works without binding any local ports; suitable for shared hosting / no root.
        _, work_dir, _ = _ensure_dirs(base_dir)
        auth_hook, cleanup_hook = _ensure_dns_hook_scripts(work_dir)
        certbot_args = [
            "certonly",
            "--manual",
            "--preferred-challenges",
            "dns",
            "--manual-public-ip-logging-ok",
            "--manual-auth-hook",
            str(auth_hook),
            "--manual-cleanup-hook",
            str(cleanup_hook),
            *_common_certbot_flags(
                email=args.email,
                domains=domains,
                base_dir=base_dir,
                production=production,
                non_interactive=True,
            ),
        ]
    else:
        certbot_args = [
            "certonly",
            "--standalone",
            # HTTP-01 is the simplest/most compatible for typical VPS setups.
            "--preferred-challenges",
            "http",
            # If port 80 is already in use, certbot can still succeed behind a reverse proxy
            # using `--webroot`, but this wrapper defaults to standalone by design.
            "--http-01-port",
            str(int(args.http_01_port)),
            *_common_certbot_flags(
                email=args.email,
                domains=domains,
                base_dir=base_dir,
                production=production,
                non_interactive=True,
            ),
        ]

    if args.force_renewal:
        certbot_args.append("--force-renewal")

    if args.test_cert:
        certbot_args.append("--test-cert")

    return _run_certbot(certbot_args)


def cmd_renew(args: argparse.Namespace) -> int:
    base_dir = Path(args.base_dir).expanduser().resolve() if args.base_dir else _default_base_dir()
    production = bool(args.production)
    config_dir, work_dir, logs_dir = _ensure_dirs(base_dir)

    certbot_args: List[str] = [
        "renew",
        "--non-interactive",
        "--config-dir",
        str(config_dir),
        "--work-dir",
        str(work_dir),
        "--logs-dir",
        str(logs_dir),
        "--key-type",
        "ecdsa",
    ]

    certbot_args += ["--server", LE_PRODUCTION_DIRECTORY_URL if production else LE_STAGING_DIRECTORY_URL]

    if args.force_renewal:
        certbot_args.append("--force-renewal")
    if args.dry_run:
        certbot_args.append("--dry-run")

    return _run_certbot(certbot_args)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m python_video_server.letsencrypt",
        description="Python-only Let’s Encrypt cert issuance/renewal (wraps certbot package).",
    )
    p.add_argument(
        "--base-dir",
        default=os.environ.get("LETSENCRYPT_BASE_DIR", ""),
        help="Where certbot state is stored (default: python_video_server/certs).",
    )
    p.add_argument(
        "--production",
        action="store_true",
        help="Use Let’s Encrypt production endpoint (default uses staging).",
    )

    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("certonly", help="Issue (or re-issue) a certificate via HTTP-01 standalone.")
    c.add_argument("--email", required=True, help="Email for Let’s Encrypt account registration.")
    c.add_argument(
        "--domains",
        required=True,
        help="Comma-separated domains (e.g. example.com,www.example.com). The first is used as the primary cert name.",
    )
    c.add_argument(
        "--http-01-port",
        default=int(os.environ.get("LE_HTTP01_PORT", "80")),
        type=int,
        help="Port to bind for HTTP-01 challenge (default: 80).",
    )
    c.add_argument(
        "--challenge",
        default=os.environ.get("LE_CHALLENGE", "http"),
        choices=["http", "dns"],
        help="ACME challenge type: http (standalone) or dns (manual TXT record). Default: http.",
    )
    c.add_argument("--force-renewal", action="store_true", help="Force issuance even if not close to expiry.")
    c.add_argument(
        "--test-cert",
        action="store_true",
        help="Obtain a test certificate from staging (alias for staging behavior; kept for familiarity).",
    )
    c.set_defaults(_handler=cmd_certonly)

    r = sub.add_parser("renew", help="Renew any existing certificates in the base-dir.")
    r.add_argument("--dry-run", action="store_true", help="Perform a dry-run renewal.")
    r.add_argument("--force-renewal", action="store_true", help="Force renewal even if not due.")
    r.set_defaults(_handler=cmd_renew)

    return p


def main(argv: List[str] | None = None) -> int:
    parser = _build_parser()
    ns = parser.parse_args(argv if argv is not None else sys.argv[1:])
    handler = getattr(ns, "_handler", None)
    if handler is None:
        raise SystemExit("No command selected")
    return int(handler(ns))


if __name__ == "__main__":
    raise SystemExit(main())

