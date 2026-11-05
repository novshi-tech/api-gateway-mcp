#!/usr/bin/env python3
"""Runs git against a repository through the API gateway.

Usage:
  gw_git.py <git arguments...>            e.g. gw_git.py clone "$(gw_git.py --url github-git owner/repo)"
  gw_git.py --url <service> <owner/repo>  prints the repository's URL on the gateway

The gateway token (GW_TOKEN) goes to git as configuration in the environment
(GIT_CONFIG_COUNT), not on the command line or in .git/config, and only for URLs
under GW_BASE_URL: other remotes and submodules never see it. For those URLs,
credential helpers are switched off so that no stored password is tried, and
GIT_TERMINAL_PROMPT=0 makes a rejected token fail instead of asking for a password.
"""
import os
import subprocess
import sys

from gwlib import gateway_env


def repo_url(base, service, repo):
    repo = repo.strip("/")
    return f"{base}/{service}/{repo}" if repo.endswith(".git") else f"{base}/{service}/{repo}.git"


def git_env(base, token, environ):
    """The environment for git: the gateway token as the Authorization header for URLs under base."""
    env = dict(environ)
    count = int(env.get("GIT_CONFIG_COUNT", "0") or "0")
    for key, value in ((f"http.{base}/.extraHeader", f"Authorization: Bearer {token}"), (f"credential.{base}/.helper", "")):
        env[f"GIT_CONFIG_KEY_{count}"] = key
        env[f"GIT_CONFIG_VALUE_{count}"] = value
        count += 1
    env["GIT_CONFIG_COUNT"] = str(count)
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    base, token = gateway_env()
    if argv[0] == "--url":
        if len(argv) != 3:
            raise SystemExit("usage: gw_git.py --url <service> <owner/repo>")
        print(repo_url(base, argv[1], argv[2]))
        return 0
    return subprocess.call(["git", *argv], env=git_env(base, token, os.environ))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
