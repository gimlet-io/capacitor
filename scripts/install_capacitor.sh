#!/usr/bin/env bash

set -euo pipefail

# Colors and styles
if [[ -t 1 ]]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  RED="\033[31m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  BLUE="\033[34m"
  MAGENTA="\033[35m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; MAGENTA=""; CYAN=""; RESET=""
fi
                                                                
ASCII_ART="${DIM}
 ██████╗ █████╗ ██████╗  █████╗  ██████╗██╗████████╗ ██████╗ ██████╗     ███╗   ██╗███████╗██╗  ██╗████████╗
██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║╚══██╔══╝██╔═══██╗██╔══██╗    ████╗  ██║██╔════╝╚██╗██╔╝╚══██╔══╝
██║     ███████║██████╔╝███████║██║     ██║   ██║   ██║   ██║██████╔╝    ██╔██╗ ██║█████╗   ╚███╔╝    ██║   
██║     ██╔══██║██╔═══╝ ██╔══██║██║     ██║   ██║   ██║   ██║██╔══██╗    ██║╚██╗██║██╔══╝   ██╔██╗    ██║   
╚██████╗██║  ██║██║     ██║  ██║╚██████╗██║   ██║   ╚██████╔╝██║  ██║    ██║ ╚████║███████╗██╔╝ ██╗   ██║   
 ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ╚═╝    ${RESET}\n"
                                                                                                                                                              
print_header() {
  echo -e "$ASCII_ART"
  echo -e "${BOLD}Capacitor Next Installer${RESET}\n"
}

log()      { echo -e "${DIM}$*${RESET}"; }
info()     { echo -e "${BLUE}➜${RESET} $*"; }
success()  { echo -e "${GREEN}✔${RESET} $*"; }
warn()     { echo -e "${YELLOW}⚠${RESET} $*"; }
error()    { echo -e "${RED}✖ $*${RESET}" >&2; }

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_header

if ! command_exists wget; then
  error "wget is required. Install it (e.g., macOS: 'brew install wget') and re-run."; exit 1
fi

OS_NAME=$(uname)
ARCH_NAME=$(uname -m)
info "Detected platform: ${BOLD}${OS_NAME} ${ARCH_NAME}${RESET}"

RELEASE_TAG=""
if [[ $# -gt 0 ]]; then
  RELEASE_TAG="$1"
  info "Using requested tag: ${BOLD}${RELEASE_TAG}${RESET}"
else
  RELEASE_TAG=$(wget -qO- https://api.github.com/repos/gimlet-io/capacitor/releases/latest \
    | grep tag_name \
    | cut -d '"' -f4 || true)
  if [[ -z "${RELEASE_TAG}" ]]; then
    error "Could not determine latest release tag from GitHub API"
    exit 1
  fi
fi

ASSET_NAME="next-${OS_NAME}-${ARCH_NAME}"
DOWNLOAD_URL="https://github.com/gimlet-io/capacitor/releases/download/${RELEASE_TAG}/${ASSET_NAME}"

info "Release tag: ${BOLD}${RELEASE_TAG}${RESET}"
info "Downloading: ${BOLD}${DOWNLOAD_URL}${RESET}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
TMP_FILE="${TMP_DIR}/next"

if ! wget -q --show-progress -O "${TMP_FILE}" "${DOWNLOAD_URL}"; then
  error "Download failed. Check your connectivity and that the asset exists."
  exit 1
fi

chmod +x "${TMP_FILE}"
success "Downloaded binary"

# Decide install directory automatically
if [[ -w "/usr/local/bin" ]]; then
  INSTALL_DIR="/usr/local/bin"
elif [[ -d "/opt/homebrew/bin" && -w "/opt/homebrew/bin" ]]; then
  INSTALL_DIR="/opt/homebrew/bin"
elif [[ -d "${HOME}/.local/bin" || -w "${HOME}" ]]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
else
  INSTALL_DIR="${HOME}/bin"
  mkdir -p "${INSTALL_DIR}"
fi

TARGET_FILE="${INSTALL_DIR}/next"

if [[ -e "${TARGET_FILE}" ]]; then
  warn "Overwriting existing ${TARGET_FILE}"
fi

if [[ -w "${INSTALL_DIR}" ]]; then
  info "Installing to ${BOLD}${INSTALL_DIR}${RESET}"
  mv -f "${TMP_FILE}" "${TARGET_FILE}"
elif command_exists sudo; then
  info "Installing to ${BOLD}${INSTALL_DIR}${RESET} (with sudo)"
  sudo mv -f "${TMP_FILE}" "${TARGET_FILE}"
else
  warn "${INSTALL_DIR} is not writable and sudo is unavailable. Saving to current directory instead."
  TARGET_FILE="$(pwd)/next"
  mv -f "${TMP_FILE}" "${TARGET_FILE}"
fi

success "Installed ${BOLD}${TARGET_FILE}${RESET}"

if ! echo ":$PATH:" | grep -q ":$(dirname "${TARGET_FILE}"):"; then
  warn "$(dirname "${TARGET_FILE}") is not on your PATH"
  echo -e "Add to PATH, for example:\n  ${DIM}export PATH=\"$(dirname "${TARGET_FILE}"):\$PATH\"${RESET}"
fi

echo
echo -e "${BOLD}Next steps${RESET}"
echo -e "- Run:  ${GREEN}next${RESET}"
echo -e "- Open: ${CYAN}http://localhost:4739${RESET} in your browser"
echo -e "- Help: ${DIM}next --help${RESET}"
echo
echo -e "${MAGENTA}Happy Fluxing!${RESET} ✨"
