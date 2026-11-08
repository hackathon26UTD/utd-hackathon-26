// Shell completion scripts generated from whatever command files exist.
export function completionScript(shell, names) {
  const words = names.join(' ');
  const flags = '--json --local --site --no-color --verbose --quiet --help --version';
  if (shell === 'zsh') {
    return `#compdef hb\n# Install: eval "$(npm run --silent hb -- completion zsh)"\n_hb() {\n  local -a cmds\n  cmds=(${names.map((n) => `'${n}'`).join(' ')})\n  if (( CURRENT == 2 )); then\n    _describe 'command' cmds\n  else\n    _arguments '*:flag:(${flags})'\n  fi\n}\ncompdef _hb hb\ncompdef _hb 'npm run hb'\n`;
  }
  if (shell === 'bash') {
    return `# Install: eval "$(npm run --silent hb -- completion bash)"\n_hb() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}"\n  if [ "\${COMP_CWORD}" -le 1 ] || [ "\${COMP_WORDS[COMP_CWORD-1]}" = "--" ]; then\n    COMPREPLY=( $(compgen -W "${words}" -- "$cur") )\n  else\n    COMPREPLY=( $(compgen -W "${flags}" -- "$cur") )\n  fi\n}\ncomplete -F _hb hb\n`;
  }
  return null;
}
