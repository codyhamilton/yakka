#!/usr/bin/env bash
# Hook-side capture. Drops the raw hook payload into the queue and returns: no parsing, no network,
# no Python. Never fails the agent (always exit 0). `yakka drain` normalises, scrubs, archives and posts later.
#   spool.sh --harness <claude|cursor|opencode|codex> [--event NAME]
# Queue dir ${YAKKA_QUEUE:-~/.local/share/yakka/queue}. A missing or `auto` harness, or a payload without a
# conversation ID, is not spooled (and nothing is kicked).
# One file per event, written under tmp/ then renamed, so a reader never sees a partial file and concurrent hooks never interleave.
# Name = <conversation_id>-<ts>-<pid>-<rand>.evt; the ID is a bounded text match (first 64 KiB, bash builtins only) on
# "session_id", "conversation_id", "sessionID" in that order, with characters outside [A-Za-z0-9._-] turned into _.
# File = one JSON envelope line {"ts","harness","event"} followed by the raw payload.
# Kick: `$YAKKA_BIN drain` when YAKKA_BIN is set and executable, else `python3 <plugin>/client/yakka.py drain`, detached, one at a time
# (flock probe, or a mkdir+pid lock under <queue>/.kick.d without flock(1); YAKKA_SPOOL_NOFLOCK=1 forces that).
# YAKKA_HOOKLOG=off disables capture. YAKKA_HOOKLOG_KICK=0 stops hooks starting a background drain.
# Runs under bash 3.2 (macOS): bash builtins plus head, date, find; no flock(1) needed.

harness= event=
while [ $# -gt 0 ]; do
  case $1 in
    --harness) harness=${2:-}; shift 2 ;;
    --event) event=${2:-}; shift 2 ;;
    *) shift ;;
  esac
done
harness=${harness//[^A-Za-z0-9._-]/}
event=${event//[^A-Za-z0-9._-]/}
ACTION_JSON=

# Only session-start hooks capture work tags. Values stay raw for server validation; this
# guard removes control bytes and keeps over-length values over the server's 256-byte limit.
json_string() {
  local value=$1 i c n bytes=0 out= char_bytes
  for ((i=0; i<${#value}; i++)); do
    c=${value:i:1}
    printf -v n '%d' "'$c"
    if [ "$n" -lt 32 ] || [ "$n" -eq 127 ]; then continue; fi
    char_bytes=$(LC_ALL=C printf '%s' "$c" | wc -c | tr -d ' ')
    bytes=$((bytes + char_bytes))
    out+=$c
    if [ "$bytes" -ge 257 ]; then break; fi
  done
  value=$out
  out='"'
  for ((i=0; i<${#value}; i++)); do
    c=${value:i:1}
    case $c in
      '"') out+='\"' ;;
      $'\\') out+='\\' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      *)
        printf -v n '%d' "'$c"
        if [ "$n" -lt 32 ] || [ "$n" -eq 127 ]; then
          printf -v c '\\u%04x' "$n"
        fi
        out+=$c
        ;;
    esac
  done
  REPLY="$out\""
}

action_json() {
  [ "$event" = SessionStart ] || [ "$event" = sessionStart ] || return
  local key var val any=0 first=1 result='"action":{'
  for key in KIND SUBJECT_TYPE SUBJECT_ID PHASE REPO PR; do
    var="YAKKA_ACTION_$key"
    val=${!var-}
    [ -n "$val" ] || continue
    any=1
    [ "$first" = 1 ] || result+=','
    first=0
    json_string "$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"
    result+="$REPLY:"
    json_string "$val"
    result+=$REPLY
  done
  [ "$any" = 1 ] || return
  ACTION_JSON="${result}}"
}

dir=${YAKKA_QUEUE:-$HOME/.local/share/yakka/queue}
spooled=
spooled_name=

conv_id() {  # $1 = file; sets REPLY to the sanitised conversation ID, or empty
  local buf key
  REPLY=
  buf=$(head -c 65536 "$1" 2>/dev/null)
  for key in session_id conversation_id sessionID; do
    if [[ $buf =~ \"$key\"[[:space:]]*:[[:space:]]*\"([^\"\\]{1,128})\" ]]; then
      REPLY=${BASH_REMATCH[1]//[^A-Za-z0-9._-]/_}
      return
    fi
  done
}

spool() {
  case "${YAKKA_HOOKLOG:-}" in 0 | off | OFF | false | FALSE) return ;; esac
  case $harness in '' | auto) return ;; esac
  umask 077
  mkdir -p "$dir/tmp" 2>/dev/null || return
  local ts
  ts=$(date +%s.%N 2>/dev/null)
  case $ts in '' | *[!0-9.]*) ts=$(date +%s) ;; esac
  local name="$ts-$$-$RANDOM"
  action_json
  local extra=
  [ -z "${ACTION_JSON:-}" ] || extra=,"$ACTION_JSON"
  { printf '{"ts":%s,"harness":"%s","event":"%s"%s}\n' "$ts" "$harness" "$event" "$extra"; cat; } >"$dir/tmp/$name" 2>/dev/null || return
  conv_id "$dir/tmp/$name"
  local id=$REPLY
  if [ -z "$id" ]; then rm -f "$dir/tmp/$name"; return; fi
  if mv "$dir/tmp/$name" "$dir/$id-$name.evt" 2>/dev/null; then
    spooled=1
    spooled_name="$id-$name.evt"
  fi
}

start_drain() {  # $1 = optional prefix (setsid); detached, so $! is the drain's pid
  local root
  if [ -n "${YAKKA_BIN:-}" ]; then
    YAKKA_QUEUE="$dir" ${1:+"$1"} nohup "$YAKKA_BIN" drain </dev/null >/dev/null 2>&1 &
  else
    root=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd -P) || return 1
    YAKKA_QUEUE="$dir" ${1:+"$1"} nohup python3 "$root/client/yakka.py" drain </dev/null >/dev/null 2>&1 &
  fi
}

kick() {
  # Ensure one detached drain is running. Called after the event is spooled, so the drain either sees the file or the lock is free.
  [ "${YAKKA_HOOKLOG_KICK:-1}" = 0 ] && return
  [ -n "$spooled" ] || return
  if [ -n "${YAKKA_BIN:-}" ] && [ ! -x "$YAKKA_BIN" ]; then return; fi
  if [ -z "${YAKKA_SPOOL_NOFLOCK:-}" ] && command -v flock >/dev/null 2>&1; then
    if [ -e "$dir/.drain.lock" ]; then
      flock -n "$dir/.drain.lock" true 2>/dev/null || return  # held: a drain is running
    fi
    if command -v setsid >/dev/null 2>&1; then (start_drain setsid); else (start_drain); fi
    return
  fi
  # No flock(1): mkdir lock with a PID check. The drain's own flock(2) stays the real singleton.
  local lock="$dir/.kick.d" attempt=0 pid
  while [ $attempt -lt 2 ]; do
    attempt=$((attempt + 1))
    if mkdir "$lock" 2>/dev/null; then
      start_drain || { rmdir "$lock" 2>/dev/null; return; }
      echo $! >"$lock/pid" 2>/dev/null
      return
    fi
    if [ -f "$lock/pid" ]; then
      pid=$(cat "$lock/pid" 2>/dev/null)
      case $pid in '' | *[!0-9]*) ;; *) kill -0 "$pid" 2>/dev/null && return ;; esac
    else
      [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] || return
    fi
    rm -rf "$lock" 2>/dev/null
  done
}

spool
if [ "${YAKKA_SPOOL_PRINT:-}" = 1 ] && [ -n "$spooled_name" ]; then
  printf '%s\n' "$spooled_name"
fi
case "${YAKKA_HOOKLOG:-}" in 0 | off | OFF | false | FALSE) ;; *) kick ;; esac

if [ "$harness" = cursor ]; then
  case $event in
    preToolUse | subagentStart | beforeShellExecution | beforeMCPExecution | beforeReadFile | beforeTabFileRead) echo '{"permission": "allow"}' ;;
    beforeSubmitPrompt) echo '{"continue": true}' ;;
    *) echo '{}' ;;
  esac
fi
exit 0
