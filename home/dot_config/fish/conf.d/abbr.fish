if type -q bat
    abbr cat bat
end

if type -q brew
    abbr bup brew update; brew upgrade; brew autoremove; brew cleanup
end

if type -q chezmoi
    abbr cm chezmoi
end

if type -q doggo
    abbr dig doggo
end

if type -q git
    abbr --command git a add
    abbr --command git c commit
    abbr --command git cane commit --amend --no-edit
    abbr --command git co checkout
    abbr --command git cob checkout -b
    abbr --command git com checkout main
    abbr --command git pl pull --rebase --autostash
    abbr --command git pu push
    abbr --command git puf push --force
    abbr --command git pl pull --rebase --autostash
end

if type -q kubectl
    abbr k kubectl
end

if type -q lsd
    abbr ls lsd
end

if type -q task
    abbr t taask
end
