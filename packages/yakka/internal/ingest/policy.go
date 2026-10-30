package ingest

// Action is what ingest does with a received hook_event fact (DESIGN "Capture and event policy").
type Action int

const (
	// Keep stores the slim envelope; the row hash is the full received envelope's.
	Keep Action = iota
	// Remove stores nothing: no fact row and no archive line.
	Remove
)

func (a Action) String() string {
	switch a {
	case Remove:
		return "remove"
	}
	return "keep"
}

type policyKey struct{ harness, event string }

// policyTable maps (harness, event) to an action. Any pair not listed is Keep. The OpenCode Remove
// entries must equal the plugin's remove-list in
// packages/opencode-yakka-hooks/src/index.ts (asserted by TestRemoveListMatchesPlugin).
var policyTable = map[policyKey]Action{
	{"opencode", "experimental.chat.system.transform"}: Remove,
	{"opencode", "chat.params"}:                        Remove,
	{"opencode", "chat.headers"}:                       Remove,
	{"opencode", "shell.env"}:                          Remove,
	{"opencode", "message.part.delta"}:                 Remove,
	{"opencode", "message.part.updated"}:               Remove,
	{"opencode", "session.status"}:                     Remove,
	{"opencode", "session.updated"}:                    Remove,
	{"opencode", "session.diff"}:                       Remove,
	{"opencode", "message.updated"}:                    Remove,
}

// Policy returns the action for a hook_event fact. The payload is accepted for callers that key a
// decision on it, though no current entry does.
func Policy(harness, event string, payload map[string]any) Action {
	return policyTable[policyKey{harness, event}]
}
