#!/usr/bin/env bash

set -Eeuo pipefail

declare -r DOTFILES_REPO_URL="https://github.com/LilDrunkenSmurf/dotfiles"

function get_os_type() {
  uname
}

function initialize_macos() {
  function install_xcode() {
    local git_cmd_path="/Library/Developer/CommandLineTools/usr/bin/git"

    if [ ! -e "${git_cmd_path}" ]; then
      # Install command line developer tool
      xcode-select --install
      # Want for user input
      echo "Press any key when the installation has completed."
      IFS= read -r -n 1 -d ''
      #          │  │    └ The first character of DELIM is used to terminate the input line, rather than newline.
      #          │  └ returns after reading NCHARS characters rather than waiting for a complete line of input.
      #          └ If this option is given, backslash does not act as an escape character. The backslash is considered to be part of the line. In particular, a backslash-newline pair may not be used as a line continuation.
    else
      echo "Command line developer tools are installed."
    fi
  }

  install_xcode
  export PATH="$PATH:/opt/homebrew/bin"
}

function initialize_linux() {
  sudo apt update
  sudo apt install \
    ca-certificates \
    git \
    curl \
    wget
}

function initialize_os_env() {
  local ostype
  ostype="$(get_os_type)"

  if [ "${ostype}" == "Darwin" ]; then
    initialize_macos
  elif [ "${ostype}" == "Linux" ]; then
    initialize_linux
  else
    echo "Invalid OS type: ${ostype}" >&2
    exit 1
  fi
}

function initialize_dotfiles() {
    function keepalive_sudo() {
        function keepalive_sudo_linux() {
            # Might as well ask for password up-front, right?
            echo "Checking for \`sudo\` access which may request your password."
            sudo -v

            # Keep-alive: update existing sudo time stamp if set, otherwise do nothing.
            while true; do
                sudo -n true
                sleep 60
                kill -0 "$$" || exit
            done 2>/dev/null &
        }
        function keepalive_sudo_macos() {
            # ref. https://github.com/reitermarkus/dotfiles/blob/master/.sh#L85-L116
            (
                builtin read -r -s -p "Password: " </dev/tty
                builtin echo "add-generic-password -U -s 'dotfiles' -a '${USER}' -w '${REPLY}'"
            ) | /usr/bin/security -i
            printf "\n"
            at_exit "
                echo -e '\033[0;31mRemoving password from Keychain …\033[0m'
                /usr/bin/security delete-generic-password -s 'dotfiles' -a '${USER}'
            "
            SUDO_ASKPASS="$(/usr/bin/mktemp)"
            at_exit "
                echo -e '\033[0;31mDeleting SUDO_ASKPASS script …\033[0m'
                /bin/rm -f '${SUDO_ASKPASS}'
            "
            {
                echo "#!/bin/sh"
                echo "/usr/bin/security find-generic-password -s 'dotfiles' -a '${USER}' -w"
            } >"${SUDO_ASKPASS}"

            /bin/chmod +x "${SUDO_ASKPASS}"
            export SUDO_ASKPASS

            if ! /usr/bin/sudo -A -kv 2>/dev/null; then
                echo -e '\033[0;31mIncorrect password.\033[0m' 1>&2
                exit 1
            fi
        }

        local ostype
        ostype="$(get_os_type)"

        if [ "${ostype}" == "Darwin" ]; then
            keepalive_sudo_macos
        elif [ "${ostype}" == "Linux" ]; then
            keepalive_sudo_linux
        else
            echo "Invalid OS type: ${ostype}" >&2
            exit 1
        fi
    }

    function run_chezmoi() {
        echo "Running chezmoi..."
        sh -c "$(curl -fsLS get.chezmoi.io)" -- init "${DOTFILES_REPO_URL}"
        ~/bin/chezmoi apply
    }

    function cleanup_chezmoi() {
        rm -f "${HOME}/bin/chezmoi"
    }

    # keepalive_sudo
    run_chezmoi
    cleanup_chezmoi
}

function initialize_shell() {
  if [ -z $(grep "zsd" "/etc/shells") ]; then
    echo "Need to add zsd as a shell"
    echo "$(which zsh)" | sudo tee -a /etc/shells 2>&1 > /dev/null
  fi
  if ! [ -z $(grep "zsh" "/etc/shells") ]; then
    echo "Changing shell to zsh"
    chsh -s $(which zsh)
  fi
  #echo "Installing Homebrew"
  #/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo "Installing oh-my-zsh"
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  echo "Installing powerlevel10k"
  git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
}

function main() {
  pushd ~ 2>&1 >/dev/null
  initialize_os_env
  initialize_dotfiles
  initialize_shell
  popd 2>&1 >/dev/null
}

main "$@"
