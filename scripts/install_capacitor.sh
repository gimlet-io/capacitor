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
  # Faded CMYK-like colors (using closest 256-color codes)
  FADED_TEAL="\033[38;5;73m"      # a muted teal/blue-green
  DUSTY_BLUE="\033[38;5;110m"     # soft dusty blue
  PALE_OLIVE="\033[38;5;149m"     # faded olive green
  WARM_GRAY="\033[38;5;244m"      # warm gray

  # Mustard yellows (earthy yellows)
  GOLDEN_MUSTARD="\033[38;5;136m" # golden mustard
  RETRO_OCHRE="\033[38;5;130m"    # ochre yellow-brown
  MUTED_MUSTARD="\033[38;5;142m"  # muted mustard yellow

  # Muted reds (soft reds, not bright)
  BRICK_RED="\033[38;5;131m"      # brick red
  DUSTY_ROSE="\033[38;5;168m"     # dusty rose
  TERRACOTTA="\033[38;5;131m"     # terracotta (same as brick red here)
  RESET="\033[0m"                 # reset colors
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; MAGENTA=""; CYAN=""; RESET=""
fi

ASCII_ART="${CYAN}
 ██████  █████  ██████   █████   ██████ ██ ████████  ██████  ██████  
██      ██   ██ ██   ██ ██   ██ ██      ██    ██    ██    ██ ██   ██ 
██      ███████ ██████  ███████ ██      ██    ██    ██    ██ ██████  
██      ██   ██ ██      ██   ██ ██      ██    ██    ██    ██ ██   ██ 
 ██████ ██   ██ ██      ██   ██  ██████ ██    ██     ██████  ██   ██ ${RESET}\n"

ASCII_ART="${CYAN}
 ██████╗ █████╗ ██████╗  █████╗  ██████╗██╗████████╗ ██████╗ ██████╗ 
██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║╚══██╔══╝██╔═══██╗██╔══██╗
██║     ███████║██████╔╝███████║██║     ██║   ██║   ██║   ██║██████╔╝
██║     ██╔══██║██╔═══╝ ██╔══██║██║     ██║   ██║   ██║   ██║██╔══██╗
╚██████╗██║  ██║██║     ██║  ██║╚██████╗██║   ██║   ╚██████╔╝██║  ██║
 ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝ ${RESET}\n"
                                                                     
ASCII_ART="${GOLDEN_MUSTARD}
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

INSTALL_DIR=""
USE_SUDO="auto"
DOWNLOAD_ONLY="false"
FORCE="false"

usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Options:
  --to <dir>        Install destination directory (default: auto-detect)
  --no-sudo         Do not use sudo even if required
  --download-only   Only download the binary into current directory
  --force           Overwrite existing binary if present
  -h, --help        Show this help

The installer downloads the latest release asset:
  https://github.com/gimlet-io/capacitor/releases/latest
and installs the binary named:
  next-\$(uname)-\$(uname -m)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      INSTALL_DIR="$2"; shift 2 ;;
    --no-sudo)
      USE_SUDO="never"; shift ;;
    --download-only)
      DOWNLOAD_ONLY="true"; shift ;;
    --force)
      FORCE="true"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      error "Unknown option: $1"; echo; usage; exit 1 ;;
  esac
done

print_header

if ! command_exists curl; then
  error "curl is required"; exit 1
fi

OS_NAME=$(uname)
ARCH_NAME=$(uname -m)
info "Detected platform: ${BOLD}${OS_NAME} ${ARCH_NAME}${RESET}"

LATEST_TAG=$(curl -fsSL https://api.github.com/repos/gimlet-io/capacitor/releases/latest \
  | grep tag_name \
  | cut -d '"' -f4 || true)

if [[ -z "${LATEST_TAG}" ]]; then
  error "Could not determine latest release tag from GitHub API"
  exit 1
fi

ASSET_NAME="next-${OS_NAME}-${ARCH_NAME}"
DOWNLOAD_URL="https://github.com/gimlet-io/capacitor/releases/download/${LATEST_TAG}/${ASSET_NAME}"

info "Latest release: ${BOLD}${LATEST_TAG}${RESET}"
info "Downloading: ${BOLD}${DOWNLOAD_URL}${RESET}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
TMP_FILE="${TMP_DIR}/next"

if ! curl -fL --progress-bar "${DOWNLOAD_URL}" -o "${TMP_FILE}"; then
  error "Download failed. Check your connectivity and that the asset exists."
  exit 1
fi

chmod +x "${TMP_FILE}"
success "Downloaded binary"

if [[ "${DOWNLOAD_ONLY}" == "true" ]]; then
  TARGET_FILE="$(pwd)/next"
  if [[ -e "${TARGET_FILE}" && "${FORCE}" != "true" ]]; then
    error "${TARGET_FILE} already exists. Use --force to overwrite."
    exit 1
  fi
  mv -f "${TMP_FILE}" "${TARGET_FILE}"
  success "Saved to ${BOLD}${TARGET_FILE}${RESET}"
else
  if [[ -z "${INSTALL_DIR}" ]]; then
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
  else
    mkdir -p "${INSTALL_DIR}"
  fi

  TARGET_FILE="${INSTALL_DIR}/next"

  NEED_SUDO="false"
  if [[ ! -w "${INSTALL_DIR}" ]]; then
    NEED_SUDO="true"
  fi

  if [[ "${NEED_SUDO}" == "true" && "${USE_SUDO}" != "never" ]]; then
    if command_exists sudo; then
      info "Installing to ${BOLD}${INSTALL_DIR}${RESET} (with sudo)"
      if [[ -e "${TARGET_FILE}" && "${FORCE}" != "true" ]]; then
        warn "${TARGET_FILE} exists; using --force to overwrite"
      fi
      sudo mv -f "${TMP_FILE}" "${TARGET_FILE}"
    else
      error "Installation directory not writable and sudo not available. Use --to <dir> or --download-only."
      exit 1
    fi
  else
    info "Installing to ${BOLD}${INSTALL_DIR}${RESET}"
    if [[ -e "${TARGET_FILE}" && "${FORCE}" != "true" ]]; then
      warn "${TARGET_FILE} exists; using --force to overwrite"
    fi
    mv -f "${TMP_FILE}" "${TARGET_FILE}"
  fi

  success "Installed ${BOLD}${TARGET_FILE}${RESET}"

  if ! echo ":$PATH:" | grep -q ":${INSTALL_DIR}:"; then
    warn "${INSTALL_DIR} is not on your PATH"
    echo -e "Add to PATH, for example:\n  ${DIM}export PATH=\"${INSTALL_DIR}:\$PATH\"${RESET}"
  fi
fi

echo
echo -e "${BOLD}Next steps${RESET}"
echo -e "- Run:  ${GREEN}next --port 3333${RESET}"
echo -e "- Open: ${CYAN}http://localhost:3333${RESET} in your browser"
echo -e "- Help: ${DIM}next --help${RESET}"
echo
echo -e "${MAGENTA}Happy Fluxing!${RESET} ✨"

