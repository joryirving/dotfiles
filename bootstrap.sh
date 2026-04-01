#!/usr/bin/env bash
# =============================================================================
# chezmoi bootstrap — sets up a new machine from scratch
# =============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/joryirving/dotfiles/main/bootstrap.sh | bash
#
# Or clone and run locally:
#   git clone https://github.com/joryirving/dotfiles ~/.local/share/dotfiles
#   ~/.local/share/dotfiles/bootstrap.sh
# =============================================================================

set -euo pipefail

DOTFILES_REPO="${DOTFILES_REPO:-https://github.com/joryirving/dotfiles.git}"
DOTFILES_DIR="${DOTFILES_DIR:-$HOME/.local/share/dotfiles}"
CHEZMOI_BIN="$HOME/.local/bin/chezmoi"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
info()  { echo "[INFO]  $*" >&2; }
warn()  { echo "[WARN]  $*" >&2; }
err()   { echo "[ERROR] $*" >&2; exit 1; }
need()  { command -v "$1" >/dev/null 2>&1 || err "required: $1 (not found in PATH)"; }

is_mac()   { [[ "$(uname -s)" == "Darwin" ]]; }
is_linux() { [[ "$(uname -s)" == "Linux"  ]]; }

# homebrew is only used on macOS and Linux (via Linuxbrew)
have_brew() {
  [[ -n "${HOMEBREW_PREFIX:-}" ]] && [[ -x "$HOMEBREW_PREFIX/bin/brew" ]] && return 0
  command -v brew >/dev/null 2>&1 && return 0
  return 1
}

# -----------------------------------------------------------------------------
# Step 0: detect OS
# -----------------------------------------------------------------------------
info "OS detection..."
if is_mac; then
  OS=macos
elif is_linux; then
  OS=linux
else
  err "unsupported OS: $(uname -s)"
fi
info "  OS: $OS"

# -----------------------------------------------------------------------------
# Step 1: install base dependencies
# -----------------------------------------------------------------------------
info "Installing base dependencies..."

install_fish() {
  if is_mac; then
    need brew
    if ! command -v fish >/dev/null 2>&1; then
      info "  installing fish (macOS)..."
      brew install fish
    fi
  elif is_linux; then
    if command -v fish >/dev/null 2>&1; then
      info "  fish already installed (linux)"
    else
      info "  installing fish (linux)..."
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y fish
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y fish
      elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm fish
      else
        err "cannot install fish automatically on this Linux distro; please install fish manually"
      fi
    fi
  fi
}

install_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    if is_mac; then
      brew install curl
    elif is_linux; then
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y curl
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y curl
      fi
    fi
  fi
}

install_git() {
  if ! command -v git >/dev/null 2>&1; then
    if is_mac; then
      brew install git
    elif is_linux; then
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y git
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y git
      fi
    fi
  fi
}

install_chezmoi() {
  if [[ -x "$CHEZMOI_BIN" ]]; then
    info "  chezmoi already installed"
    return
  fi
  info "  installing chezmoi..."
  # official install script
  curl -fsSL https://get.chezmoi.io/sh | sh -s -- --bin-dir "$HOME/.local/bin"
  chmod +x "$CHEZMOI_BIN"
}

install_starship() {
  if command -v starship >/dev/null 2>&1; then
    info "  starship already installed"
    return
  fi
  info "  installing starship..."
  if is_mac; then
    brew install starship
  elif is_linux; then
    sh -c "$(curl -fsSL https://starship.rs/install.sh)" -- --yes --bin-dir "$HOME/.local/bin"
  fi
}

install_mise() {
  if command -v mise >/dev/null 2>&1; then
    info "  mise already installed"
    return
  fi
  info "  installing mise..."
  curl -fsSL https://mise.run | sh
  local MISE_BIN="$HOME/.local/bin/mise"
  chmod +x "$MISE_BIN"
}

install_fisher() {
  local FISH_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/fish"
  local FISHER_DIR="$FISH_CONFIG_DIR/functions"
  # fisher v4+ is a fish plugin manager
  if command -v fisher >/dev/null 2>&1; then
    info "  fisher already installed"
    return
  fi
  info "  installing fisher..."
  curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/fisher.fish | fish
}

# Install Homebrew on Linux if not present
install_linuxbrew() {
  if ! is_linux; then return; fi
  if [[ -d "/home/linuxbrew/.linuxbrew" ]] || command -v brew >/dev/null 2>&1; then
    info "  linuxbrew already installed"
    return
  fi
  info "  installing Linuxbrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

# Install brew if on macOS
install_brew() {
  if ! is_mac; then return; fi
  if command -v brew >/dev/null 2>&1; then
    info "  brew already installed"
    return
  fi
  info "  installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

# -----------------------------------------------------------------------------
# Step 2: install Homebrew (macOS) or Linuxbrew (Linux)
# -----------------------------------------------------------------------------
info "Checking Homebrew..."
if is_mac; then
  install_brew
elif is_linux; then
  install_linuxbrew
fi

# Re-source brew env on Linux if newly installed
if is_linux && [[ -d "/home/linuxbrew/.linuxbrew" ]]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi

# -----------------------------------------------------------------------------
# Step 3: install core tools
# -----------------------------------------------------------------------------
info "Installing core tools..."
install_git
install_curl
install_fish
install_starship
install_mise
install_fisher

# -----------------------------------------------------------------------------
# Step 4: clone or update dotfiles repo
# -----------------------------------------------------------------------------
info "Setting up dotfiles..."
if [[ -d "$DOTFILES_DIR/.git" ]]; then
  info "  dotfiles already cloned at $DOTFILES_DIR — pulling latest..."
  git -C "$DOTFILES_DIR" pull --ff-only
else
  info "  cloning dotfiles to $DOTFILES_DIR..."
  mkdir -p "$(dirname "$DOTFILES_DIR")"
  git clone --bare "$DOTFILES_REPO" "$DOTFILES_DIR"
fi

# Ensure chezmoi can find the repo
exportchezmoi config:
  git -C "$DOTFILES_DIR" config --local init.defaultBranch main

# -----------------------------------------------------------------------------
# Step 5: run chezmoi init
# -----------------------------------------------------------------------------
info "Running chezmoi init — you will be prompted for work/personal setup..."
chezmoi init --apply --source="$DOTFILES_DIR"

info "Bootstrap complete!"
info ""
info "Next steps:"
info "  1. Restart your shell (or exec fish)"
info "  2. chezmoi will prompt for work/personal on first run"
info "  3. Review ~/.gitconfig to confirm email is set correctly"
info ""
info "To update dotfiles later:"
info "  chezmoi update"
