#!/bin/bash
# se-skills session start hook
# Injects the using-se-skills meta-skill into every new session
# Pattern: same approach as ae-skills session-start hook

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$(dirname "$SCRIPT_DIR")/skills"
META_SKILL="$SKILLS_DIR/using-se-skills/SKILL.md"

# Codex sets PLUGIN_ROOT for plugin hooks and expects hookSpecificOutput JSON;
# Claude Code sets CLAUDE_PLUGIN_ROOT and expects {priority, message}.
CODEX_HOOK=0
if [ -n "$PLUGIN_ROOT" ]; then
  CODEX_HOOK=1
fi

emit_static() {
  if [ "$CODEX_HOOK" = "1" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$2"
  else
    printf '{"priority":"%s","message":"%s"}\n' "$1" "$2"
  fi
}

emit_context() {
  if [ "$CODEX_HOOK" = "1" ]; then
    jq -cn --arg text "$1" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $text}}'
  else
    jq -cn --arg text "$1" '{priority: "IMPORTANT", message: $text}'
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  emit_static INFO "se-skills: jq is required for the session-start hook but was not found on PATH. Install jq to enable auto-pipeline injection. SE skills remain available individually via /se-requirements, /se-architecture, etc."
  exit 0
fi

if [ -f "$META_SKILL" ]; then
  CONTENT=$(cat "$META_SKILL")
  emit_context "se-skills loaded. SE pipeline ready — Define > Design > Document > Verify > Validate. If you have SE work (requirements/architecture/spec/review/traceability), tell me what you need and I will detect your current phase automatically.

$CONTENT"
else
  emit_static INFO "se-skills: using-se-skills meta-skill not found. Skills may still be available individually via slash commands."
fi
