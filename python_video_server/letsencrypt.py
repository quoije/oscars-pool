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
) -> List[str]:
    if not email.strip():
        raise SystemExit("--email is required")
    if not domains:
        raise SystemExit("--domains is required (comma-separated)")

    config_dir, work_dir, logs_dir = _ensure_dirs(base_dir)

    args: List[str] = [
        "--non-interactive",
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

