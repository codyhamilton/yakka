"""Registration smoke: run every shipped command against a temp queue and check the envelopes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
PLUGIN = ROOT / "plugins" / "yakka"
CLAUDE = set('SessionStart Setup InstructionsLoaded UserPromptSubmit UserPromptExpansion MessageDisplay PermissionRequest PermissionDenied PostToolUse PostToolUseFailure Notification SubagentStart SubagentStop TaskCreated TaskCompleted Stop StopFailure TeammateIdle ConfigChange CwdChanged DirectoryAdded FileChanged WorktreeCreate WorktreeRemove PreCompact PostCompact PreModelSwitch PostModelSwitch Elicitation ElicitationResult SessionEnd'.split())
# The supplied catalog's 22 subtotal enumerates only these 21 names; see README caveat.
CURSOR = set('sessionStart sessionEnd preToolUse postToolUse postToolUseFailure subagentStart subagentStop beforeShellExecution afterShellExecution beforeMCPExecution afterMCPExecution beforeReadFile afterFileEdit beforeSubmitPrompt preCompact stop afterAgentResponse afterAgentThought beforeTabFileRead afterTabFileEdit workspaceOpen'.split())
CODEX = set('SessionStart SessionEnd SubagentStart SubagentStop PermissionRequest PostToolUse PreCompact PostCompact UserPromptSubmit Stop Interrupt'.split())
START = {'claude': 'SessionStart', 'cursor': 'sessionStart', 'codex': 'SessionStart'}


def is_prefetch(command):
    return 'prefetch-version' in command or 'bin/yakka' in command


class SurfaceTests(unittest.TestCase):
    def test_shipped_registrations_capture_all_events(self):
        registrations = [('claude', 'plugins/yakka/hooks/hooks.json', CLAUDE), ('cursor', 'plugins/yakka/hooks/cursor.json', CURSOR),
                         ('cursor', 'packages/hooklog/cursor-hooks.example.json', CURSOR),
                         ('codex', 'plugins/yakka/hooks/codex.json', CODEX)]
        for harness, file, expected in registrations:
            with self.subTest(file=file), tempfile.TemporaryDirectory() as tmp:
                config = json.loads((ROOT / file).read_text())
                self.assertEqual(set(config['hooks']), expected)
                queue = Path(tmp) / 'queue'
                env = dict(os.environ, HOME=tmp, YAKKA_QUEUE=str(queue), YAKKA_HOOKLOG_KICK='0', TYPESAFE_API_KEY='',
                           YAKKA_BIN=str(Path(tmp) / 'stub'), CLAUDE_PLUGIN_ROOT=str(PLUGIN), CURSOR_PLUGIN_ROOT=str(PLUGIN),
                           PLUGIN_ROOT=str(PLUGIN))
                stub = Path(tmp) / 'stub'
                stub.write_text(f'#!/bin/sh\necho "$@" >> "{tmp}/stub.calls"\n')
                stub.chmod(0o755)
                prefetch_seen = 0
                run_cwd = PLUGIN if harness == 'cursor' and file.startswith('plugins/yakka') else tmp
                for event, groups in config['hooks'].items():
                    if harness == 'claude' and event in ('WorktreeCreate', 'WorktreeRemove'):
                        self.assertEqual(groups, [])  # logger must not replace host operations
                        commands = [f'bash "{PLUGIN}/script/spool.sh" --harness claude --event {event}']
                    else:
                        hooks = groups if harness == 'cursor' else [h for g in groups for h in g['hooks']]
                        replace_base = ROOT if file.startswith('packages/') else PLUGIN
                        commands = [h['command'].replace('/ABS/PATH/yakka', str(replace_base)) for h in hooks]
                    payload = {'hook_event_name': event, 'session_id': 'surface-test', 'conversation_id': 'surface-test',
                               'prompt': 'smoke'}
                    if harness == 'claude':
                        payload['transcript_path'] = '/tmp/transcript.jsonl'
                    before = set(queue.glob('*.evt')) if queue.exists() else set()
                    for command in commands:
                        result = subprocess.run(command, shell=True, input=json.dumps(payload), text=True,
                                                capture_output=True, env=env, cwd=run_cwd, timeout=10)
                        self.assertEqual(result.returncode, 0, (event, result.stderr))
                        if is_prefetch(command):
                            prefetch_seen += 1
                            self.assertEqual(event, START[harness])
                            self.assertEqual((result.stdout, result.stderr), ('', ''))
                        elif harness != 'cursor':
                            self.assertEqual(result.stdout, '')
                    new = set(queue.glob('*.evt')) - before
                    self.assertEqual(len(new), 1, (event, new))
                    lines = next(iter(new)).read_text().splitlines()
                    envelope = json.loads(lines[0])
                    # Codex registers no --event: its event is the payload's hook_event_name.
                    self.assertEqual(envelope['event'] or json.loads(lines[1])['hook_event_name'], event)
                    if harness != 'codex':
                        self.assertEqual(envelope['event'], event)
                    self.assertEqual(envelope['harness'], harness)
                self.assertEqual(prefetch_seen, 0)

    def test_cursor_manifest_selects_native_registration(self):
        manifest = json.loads((PLUGIN / '.cursor-plugin/plugin.json').read_text())
        self.assertEqual(manifest['hooks'], './hooks/cursor.json')
        self.assertTrue((PLUGIN / manifest['hooks'].lstrip('./')).is_file())

    def test_codex_manifest_selects_native_registration(self):
        # Without a Codex manifest, Codex loads hooks/hooks.json and records Codex events as claude.
        manifest = json.loads((PLUGIN / '.codex-plugin/plugin.json').read_text())
        self.assertEqual(manifest['hooks'], './hooks/codex.json')
        for key in ('hooks', 'skills', 'mcpServers'):
            rel = manifest[key][2:] if manifest[key].startswith('./') else manifest[key]
            rel = rel.rstrip('/')
            self.assertTrue((PLUGIN / rel).exists(), key)
        self.assertNotIn('--harness claude', (PLUGIN / manifest['hooks'].lstrip('./')).read_text())

    def test_manifest_versions_match(self):
        versions = {f: json.loads((PLUGIN / f).read_text())['version']
                    for f in ('.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.codex-plugin/plugin.json')}
        self.assertEqual(len(set(versions.values())), 1, versions)

if __name__ == '__main__':
    unittest.main()
